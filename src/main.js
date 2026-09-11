import { FrameBus } from './core/frame-bus.js';
import { detectFelt, layoutFromFelt, stabilizeFelt } from './core/geometry.js';
import { cropCanvas, cloneCrop, glyphVector, vectorDistance } from './core/image.js';
import { HandMachine } from './core/state-machine.js';
import { TemplateBank } from './core/template-bank.js';
import { LatencyMeter } from './core/latency.js';
import { OcrService } from './core/ocr.js';
import { classifyRankPixels } from './core/rank-classifier.js';
import { LatestLane } from './core/latest-lane.js';
import { reconcileTeacher } from './core/teacher-merge.js';
import {
  cardPresenceScore,
  boardCountFromScores,
  slotFingerprint,
  rankCrop,
} from './detectors/cards.js';
import { detectActionRects, inferActions, amountCrop } from './detectors/actions.js';
import { findPotPill, potCrop, PotConsensus } from './detectors/pot.js';
import { VisionTeacher } from './vision/teacher.js';
import { recommend } from './strategy.js';

const $ = (id) => document.getElementById(id);
const ui = {
  share: $('shareBtn'), file: $('fileInput'), stop: $('stopBtn'), diag: $('diagBtn'), stage: $('stage'), video: $('video'), image: $('image'), overlay: $('overlay'), empty: $('emptyState'),
  title: $('coachTitle'), turn: $('turnChip'), hero: $('heroCards'), board: $('boardCards'), pot: $('potValue'), street: $('streetValue'), decision: $('decisionText'), reason: $('decisionReason'), details: $('decisionDetails'), actions: $('actions'), confidence: $('confidence'), fps: $('fpsBadge'), latency: $('latencyBadge'), diagnostics: $('diagnostics'), dHand: $('dHand'), dHeroFp: $('dHeroFp'), dBoardSlots: $('dBoardSlots'), dActions: $('dActions'), dPot: $('dPot'), dTeacher: $('dTeacher'), dLatency: $('dLatency'), dFrame: $('dFrame'), dGeometry: $('dGeometry'), dLanes: $('dLanes'), dTemplates: $('dTemplates'), diagLog: $('diagLog'), visionToken: $('visionToken'), visionTokenBtn: $('visionTokenBtn'),
};

let source = null;
let stream = null;
let runtimeEpoch = 0;
let felt = null;
let layout = null;
let lastGeomAt = 0;
let lastHeroReadFp = null;
let lastBoardFp = null;
let lastBoardCount = 0;
let lastActionKey = '';
let lastPotCommitted = null;
let actionPresent = false;
let fpsSamples = [];
let lastDecisionKey = '';
let heroVerifyAt = 0;
let boardVerifyAt = 0;
const logs = [];

const machine = new HandMachine();
const bank = new TemplateBank();
const latency = new LatencyMeter();
const ocr = new OcrService();
void ocr.prewarmDigits();
const teacher = new VisionTeacher();
if (ui.visionToken && teacher.accessToken) ui.visionToken.value = teacher.accessToken;
if (ui.visionTokenBtn) ui.visionTokenBtn.onclick = () => {
  teacher.setAccessToken(ui.visionToken?.value || '');
  ui.dTeacher.textContent = teacher.accessToken ? 'token configurado' : 'token removido';
  log(teacher.accessToken ? 'Vision Teacher autenticado para esta aba.' : 'Token da Vision removido.');
};
const potConsensus = new PotConsensus();
const heroLane = new LatestLane('hero');
const boardLane = new LatestLane('board');
const potLane = new LatestLane('pot');
const actionLane = new LatestLane('actions');
const heroOcrLane = new LatestLane('hero-ocr');
const boardOcrLane = new LatestLane('board-ocr');
const teacherLane = new LatestLane('teacher');
const scratch = {
  hero: [document.createElement('canvas'), document.createElement('canvas')],
  board: Array.from({ length: 5 }, () => document.createElement('canvas')),
  action: document.createElement('canvas'),
  pot: document.createElement('canvas'),
};

function log(s) {
  logs.unshift(`${new Date().toLocaleTimeString()}  ${s}`);
  logs.splice(20);
  if (ui.diagLog) ui.diagLog.textContent = logs.join('\n');
}
function currentSource() { return source; }
const bus = new FrameBus(currentSource, { maxFps: 30 });

function resetRuntime() {
  runtimeEpoch++;
  machine.resetSession(); felt = null; layout = null; lastGeomAt = 0; lastHeroReadFp = null; lastBoardFp = null; lastBoardCount = 0; lastActionKey = ''; lastPotCommitted = null; actionPresent = false; lastDecisionKey = ''; heroVerifyAt = 0; boardVerifyAt = 0;
  potConsensus.reset(); teacher.resetSession();
  for (const lane of [heroLane, boardLane, potLane, actionLane, heroOcrLane, boardOcrLane, teacherLane]) lane.reset();
}
function handleNewHand(reason) {
  log(`nova mão ${machine.handId}: ${reason}`);
  potConsensus.reset(); lastPotCommitted = null; lastHeroReadFp = null; lastBoardFp = null; lastBoardCount = 0; lastActionKey = ''; lastDecisionKey = ''; actionPresent = false; heroVerifyAt = 0; boardVerifyAt = 0;
  teacher.resetHand(machine.handId);
  for (const lane of [heroLane, boardLane, potLane, actionLane, heroOcrLane, boardOcrLane, teacherLane]) lane.reset();
  render();
}
function setSource(el) {
  source = el; ui.empty.style.display = 'none'; ui.stage.classList.remove('empty'); ui.video.style.display = el === ui.video ? 'block' : 'none'; ui.image.style.display = el === ui.image ? 'block' : 'none'; resetRuntime(); render();
}

ui.share.onclick = async () => {
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio: false });
    ui.video.srcObject = stream; ui.video.controls = false; await ui.video.play(); setSource(ui.video); bus.start(); stream.getVideoTracks()[0].addEventListener('ended', stop);
  } catch (e) { log(`captura cancelada: ${e.message}`); }
};
ui.file.onchange = () => {
  const f = ui.file.files?.[0]; if (!f) return; const url = URL.createObjectURL(f);
  if (f.type.startsWith('image/')) { ui.image.onload = () => { setSource(ui.image); bus.start(); }; ui.image.src = url; }
  else { ui.video.srcObject = null; ui.video.src = url; ui.video.controls = true; ui.video.loop = false; ui.video.onloadeddata = () => { setSource(ui.video); bus.start(); }; ui.video.play().catch(() => {}); }
};
ui.stop.onclick = stop;
ui.diag.onclick = () => ui.diagnostics.classList.toggle('hidden');
function stop() {
  bus.stop(); if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
  source = null; ui.video.srcObject = null; ui.video.style.display = 'none'; ui.image.style.display = 'none'; ui.empty.style.display = 'block'; resetRuntime(); render();
}

const fmt = (n) => Intl.NumberFormat('pt-BR').format(Math.round(n));
const normKey = (cards) => cards.map((c) => c.rank || '?').join('');
const vectorPreview = (v) => (v ? Array.from(v.slice(0, 8)).map((x) => Math.round(x * 9)).join('') : '—');
function unionNorm(rects, pad = 0) {
  const x = Math.max(0, Math.min(...rects.map((r) => r.x)) - pad), y = Math.max(0, Math.min(...rects.map((r) => r.y)) - pad), right = Math.min(1, Math.max(...rects.map((r) => r.x + r.w)) + pad), bottom = Math.min(1, Math.max(...rects.map((r) => r.y + r.h)) + pad);
  return { x, y, w: right - x, h: bottom - y };
}
function classifyLocalRank(slotCrop) {
  const seeded = classifyRankPixels(slotCrop.data, slotCrop.w, slotCrop.h);
  const vector = glyphVector(slotCrop.data, slotCrop.w, slotCrop.h, { x: 0, y: 0, w: slotCrop.w, h: slotCrop.h });
  if (seeded.rank) return { rank: seeded.rank, suit: null, confidence: seeded.confidence, source: 'seeded-template', vector, mask: seeded.mask, candidate: seeded.candidate, distance: seeded.distance };
  const learned = bank.classify(vector, ['2','3','4','5','6','7','8','9','T','J','Q','K','A']);
  if (learned.label && learned.confidence >= 0.9) return { rank: learned.label, suit: null, confidence: learned.confidence, source: 'learned-template', vector, mask: seeded.mask };
  return { rank: null, suit: null, confidence: Math.max(seeded.confidence || 0, learned.confidence || 0), source: 'unknown', vector, mask: seeded.mask, candidate: seeded.candidate, distance: seeded.distance };
}
async function classifyRank(slotCrop, { allowOcr = true, ocrLane = 'hero', local = null } = {}) {
  const seededLocal = local || classifyLocalRank(slotCrop);
  if (seededLocal.rank || !allowOcr) return seededLocal;
  const vector = seededLocal.vector;
  const learned = bank.classify(vector, ['2','3','4','5','6','7','8','9','T','J','Q','K','A']);
  const r = await ocr.readRank(rankCrop(slotCrop.canvas), ocrLane);
  return { rank: r.value || learned.label || null, suit: null, confidence: r.value ? Math.max(0.45, (r.confidence || 0) / 100) : learned.confidence || 0, source: r.value ? 'ocr-fallback' : learned.label ? 'learned-template' : 'unknown', vector, mask: seededLocal.mask };
}
function teacherCrop(frameCanvas, rects) { return cropCanvas(frameCanvas, unionNorm(rects, 0.012), 420).canvas; }
function authoritativeHero(localCards, handId, fp, frameCanvas, sourceEpoch) {
  if (handId !== machine.handId || sourceEpoch !== runtimeEpoch) return;
  if (localCards.every((c) => c.rank)) { machine.setHero(localCards, handId); lastHeroReadFp = fp; render(); }
  if (!teacher.shouldRead('hero', handId, 2, normKey(localCards))) return;
  const frozen = teacherCrop(frameCanvas, layout.heroSlots);
  teacherLane.run(async () => {
    const out = await teacher.read('hero', frozen, handId, { expectedCount: 2, fingerprint: normKey(localCards) });
    if (!out || sourceEpoch !== runtimeEpoch || handId !== machine.handId) return;
    const merge = reconcileTeacher(localCards, out.cards || []);
    if (!merge.accepted) return;
    machine.setHero(merge.cards, handId); lastHeroReadFp = fp;
    merge.learn.forEach((it) => { const c = localCards[it.index]; if (it.rank && c?.vector) bank.learn(it.rank, c.vector, it.weight); });
    render();
  });
}
function scheduleHeroRead(heroCrops, fp, handId, frameCanvas, quickCards) {
  const sourceEpoch = runtimeEpoch, frozen = heroCrops.map(cloneCrop), quick = quickCards || frozen.map(classifyLocalRank);
  authoritativeHero(quick, handId, fp, frameCanvas, sourceEpoch);
  if (quick.every((c) => c.rank)) return;
  heroOcrLane.run(async () => {
    const cards = [];
    for (let i = 0; i < frozen.length; i++) cards.push(await classifyRank(frozen[i], { allowOcr: true, ocrLane: 'hero', local: quick[i] }));
    if (sourceEpoch !== runtimeEpoch || handId !== machine.handId) return;
    authoritativeHero(cards, handId, fp, frameCanvas, sourceEpoch);
  });
}
function authoritativeBoard(localCards, count, handId, fp, frameCanvas, sourceEpoch) {
  if (sourceEpoch !== runtimeEpoch || handId !== machine.handId) return;
  if (localCards.length === count && localCards.every((c) => c.rank)) { machine.setBoard(localCards, handId); lastBoardFp = fp; lastBoardCount = count; render(); }
  if (!teacher.shouldRead('board', handId, count, normKey(localCards))) return;
  const frozen = teacherCrop(frameCanvas, layout.boardSlots.slice(0, count));
  teacherLane.run(async () => {
    const out = await teacher.read('board', frozen, handId, { expectedCount: count, fingerprint: normKey(localCards) });
    if (!out || sourceEpoch !== runtimeEpoch || handId !== machine.handId) return;
    const merge = reconcileTeacher(localCards, out.cards || []); if (!merge.accepted || merge.cards.length !== count) return;
    machine.setBoard(merge.cards, handId); lastBoardFp = fp; lastBoardCount = count;
    merge.learn.forEach((it) => { const c = localCards[it.index]; if (it.rank && c?.vector) bank.learn(it.rank, c.vector, it.weight); });
    render();
  });
}
function scheduleBoardRead(boardCrops, count, fp, handId, frameCanvas) {
  const sourceEpoch = runtimeEpoch, frozen = boardCrops.slice(0, count).map(cloneCrop), quick = frozen.map(classifyLocalRank);
  authoritativeBoard(quick, count, handId, fp, frameCanvas, sourceEpoch);
  if (quick.every((c) => c.rank)) return;
  boardOcrLane.run(async () => {
    const cards = [];
    for (let i = 0; i < frozen.length; i++) cards.push(await classifyRank(frozen[i], { allowOcr: true, ocrLane: 'board', local: quick[i] }));
    if (sourceEpoch !== runtimeEpoch || handId !== machine.handId) return;
    authoritativeBoard(cards, count, handId, fp, frameCanvas, sourceEpoch);
  });
}
function actionGeometryKey(rects) { return rects.map((r) => `${Math.round(r.x/5)}:${Math.round(r.w/5)}`).join('|'); }
function scheduleActionAmounts(actionCrop, actions, handId, geometryKey) {
  const sourceEpoch = runtimeEpoch, frozen = cloneCrop(actionCrop);
  actionLane.run(async () => {
    const updated = actions.map((a) => ({ ...a }));
    for (let i = 0; i < updated.length; i++) {
      if (!['call','raise','bet'].includes(updated[i].type)) continue;
      const c = amountCrop(frozen.canvas, updated[i].rect); const read = await ocr.readNumber(c, 'action');
      if (Number.isFinite(read.value)) updated[i].amount = read.value;
    }
    if (sourceEpoch !== runtimeEpoch || handId !== machine.handId || geometryKey !== lastActionKey) return;
    machine.setActions(updated, handId); render();
  });
}
function schedulePotRead(frameCanvas, handId) {
  const sourceEpoch = runtimeEpoch, zone = cloneCrop(cropCanvas(frameCanvas, layout.pot, 300, scratch.pot));
  const pill = findPotPill(zone.data, zone.w, zone.h); if (!pill) return;
  const frozen = potCrop(zone.canvas, pill);
  potLane.run(async () => {
    const r = await ocr.readNumber(frozen, 'pot');
    if (sourceEpoch !== runtimeEpoch || handId !== machine.handId || !Number.isFinite(r.value)) return;
    const life = machine.observePotValue(r.value, performance.now()); if (life.newHand) handleNewHand(life.reason);
    const v = potConsensus.observe(r.value); if (v !== null && machine.handId === handId) { machine.setPot(v, handId); lastPotCommitted = v; render(); }
  });
}
function render() {
  const s = machine.state; ui.dHand.textContent = machine.handId; ui.hero.textContent = s.hero.length ? s.hero.map((c) => c.rank + (c.suit ? ` ${c.suit[0]}` : '')).join(' ') : '—'; ui.board.textContent = s.board.length ? s.board.map((c) => c.rank).join(' ') : '—'; ui.pot.textContent = s.pot ? fmt(s.pot) : '—'; ui.street.textContent = s.street; ui.turn.textContent = s.heroToAct ? 'SUA VEZ' : 'FORA DA VEZ'; ui.turn.classList.toggle('active', s.heroToAct); ui.title.textContent = s.heroToAct ? 'Decisão do Hero' : source ? 'Acompanhando replay' : 'Aguardando replay';
  ui.actions.innerHTML = ''; for (const a of s.actions) { const el = document.createElement('span'); el.className = 'action-pill'; el.textContent = `${a.type.toUpperCase()}${a.amount ? ` ${fmt(a.amount)}` : ''}`; ui.actions.appendChild(el); }
  const out = s.heroToAct ? recommend(s) : { decision: null, reason: 'Aguardando sua vez.', confidence: 0, details: [] };
  ui.decision.textContent = out.decision || (s.heroToAct ? 'LEITURA INSUFICIENTE' : '—'); ui.reason.textContent = out.reason; if (ui.details) ui.details.textContent = (out.details || []).slice(0, 3).join(' · ');
  const cardConfs = [...s.hero, ...s.board].map((c) => c.confidence || 0).filter(Boolean); const cardConf = cardConfs.length ? cardConfs.reduce((a,b)=>a+b,0)/cardConfs.length : 0; const combined = out.confidence ? Math.round(out.confidence * 0.65 + cardConf * 100 * 0.35) : Math.round(cardConf * 100); ui.confidence.textContent = combined ? `${combined}%` : '—';
  if (s.heroToAct && out.decision) { const key = `${machine.handId}:${s.street}:${out.decision}:${s.actions.map((a) => `${a.type}${a.amount ?? ''}`).join(',')}`; if (key !== lastDecisionKey) { lastDecisionKey = key; const ms = latency.decision(); if (ms !== null) { ui.latency.textContent = `${ms} ms`; ui.dLatency.textContent = `${ms} ms`; log(`recomendação ${out.decision} em ${ms}ms`); } } }
  if (ui.dTemplates) ui.dTemplates.textContent = JSON.stringify(bank.counts()); if (ui.dLanes) ui.dLanes.textContent = `H ${heroLane.lastMs ?? '-'} / HO ${heroOcrLane.lastMs ?? '-'} / B ${boardLane.lastMs ?? '-'} / BO ${boardOcrLane.lastMs ?? '-'} / P ${potLane.lastMs ?? '-'} / A ${actionLane.lastMs ?? '-'} ms`;
}
function drawOverlay(frame, heroSlots = [], boardSlots = [], actionRects = []) {
  const c = ui.overlay, r = ui.stage.getBoundingClientRect(); c.width = Math.max(1, Math.round(r.width)); c.height = Math.max(1, Math.round(r.height)); const ctx = c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height); if (ui.diagnostics.classList.contains('hidden')) return; const scale = Math.min(c.width/frame.w,c.height/frame.h), ox=(c.width-frame.w*scale)/2, oy=(c.height-frame.h*scale)/2; ctx.lineWidth=2;
  const box=(rect,label)=>{ctx.strokeStyle='rgba(94,211,151,.95)';ctx.strokeRect(ox+rect.x*scale,oy+rect.y*scale,rect.w*scale,rect.h*scale);ctx.fillStyle='rgba(6,14,10,.8)';ctx.fillRect(ox+rect.x*scale,oy+rect.y*scale,Math.max(35,label.length*7),17);ctx.fillStyle='#72e4aa';ctx.font='11px monospace';ctx.fillText(label,ox+rect.x*scale+3,oy+rect.y*scale+12);};
  heroSlots.forEach((r,i)=>box(r,`hero${i+1}`)); boardSlots.forEach((r,i)=>box(r,`b${i+1}`)); actionRects.forEach((r)=>box(r,'action'));
}
bus.on((frame) => {
  ui.dFrame.textContent = frame.seq; const now = performance.now(); fpsSamples.push(now); while (fpsSamples.length && now - fpsSamples[0] > 1000) fpsSamples.shift(); ui.fps.textContent = `${fpsSamples.length} FPS`;
  if (!layout || now - lastGeomAt > 300) { const next = detectFelt(frame); if (next) { felt = stabilizeFelt(felt, next); layout = layoutFromFelt(felt); lastGeomAt = now; if (ui.dGeometry) ui.dGeometry.textContent = `${felt.x.toFixed(3)},${felt.y.toFixed(3)} ${felt.w.toFixed(3)}×${felt.h.toFixed(3)}`; } }
  if (!layout) return;
  let heroAbs = [];
  if (frame.seq % 2 === 0) {
    const heroCrops = layout.heroSlots.map((slot,i)=>cropCanvas(frame.canvas,slot,96,scratch.hero[i])); const scores = heroCrops.map((c)=>cardPresenceScore(c.data,c.w,c.h)); const present = scores.every((s)=>s>=0.28); const quickCards = present ? heroCrops.map((crop)=>classifyLocalRank(crop)) : [];
    const identity = present && quickCards.length === 2 && quickCards.some((c)=>c.rank) ? quickCards.map((c)=>c.rank ?? null) : null; const identityLabel = identity ? identity.map((r)=>r??'?').join('') : '??'; const fp = present ? slotFingerprint(heroCrops) : null; const obs = machine.observeHero(identity,present,now); ui.dHeroFp.textContent = `${identityLabel} · ${vectorPreview(fp)} · ${scores.map((s)=>s.toFixed(2)).join('/')}`; if (obs.newHand) handleNewHand(obs.reason);
    if (present) { const semanticMismatch = identity && machine.state.hero.length===2 && identity.some((rank,i)=>rank&&machine.state.hero[i]?.rank&&rank!==machine.state.hero[i].rank); if (obs.newHand || machine.state.hero.length<2 || semanticMismatch || now>=heroVerifyAt) { heroVerifyAt=now+1400; scheduleHeroRead(heroCrops,fp,machine.handId,frame.canvas,quickCards); } }
    heroAbs = layout.heroSlots.map((s)=>({x:s.x*frame.w,y:s.y*frame.h,w:s.w*frame.w,h:s.h*frame.h}));
  }
  let boardAbs=[];
  if (frame.seq % 2===0) {
    const boardCrops=layout.boardSlots.map((slot,i)=>cropCanvas(frame.canvas,slot,96,scratch.board[i])); const scores=boardCrops.map((c)=>cardPresenceScore(c.data,c.w,c.h)); const count=boardCountFromScores(scores,0.28); ui.dBoardSlots.textContent=`${count} · ${scores.map((s)=>s.toFixed(2)).join('/')}`; machine.setBoardOccupancy(count,machine.handId); const boardLife=machine.observeBoardCount(count,now); if(boardLife.newHand)handleNewHand(boardLife.reason);
    if(count===0){ if(machine.state.board.length){machine.setBoard([],machine.handId);lastBoardFp=null;lastBoardCount=0;render();} }
    else { const fp=slotFingerprint(boardCrops.slice(0,count)); const changed=lastBoardFp?vectorDistance(lastBoardFp,fp)>0.09:true; if(count!==lastBoardCount||machine.state.board.length!==count||changed||now>=boardVerifyAt){boardVerifyAt=now+1800;scheduleBoardRead(boardCrops,count,fp,machine.handId,frame.canvas);} boardAbs=layout.boardSlots.slice(0,count).map((s)=>({x:s.x*frame.w,y:s.y*frame.h,w:s.w*frame.w,h:s.h*frame.h})); }
  }
  const actionCrop=cropCanvas(frame.canvas,layout.action,500,scratch.action); const rects=detectActionRects(actionCrop.data,actionCrop.w,actionCrop.h); ui.dActions.textContent=rects.length; const present=rects.length>=2; let actionAbs=[];
  if(present){ const key=actionGeometryKey(rects); const inferred=inferActions(rects,actionCrop.data,actionCrop.w,actionCrop.h,machine.state.street); if(!actionPresent){actionPresent=true;latency.turn();log(`SUA VEZ por botões (${rects.length})`);machine.setActions(inferred,machine.handId);lastActionKey=key;render();scheduleActionAmounts(actionCrop,inferred,machine.handId,key);} else if(key!==lastActionKey){lastActionKey=key;machine.setActions(inferred,machine.handId);render();scheduleActionAmounts(actionCrop,inferred,machine.handId,key);} else if(machine.state.actions.some((a)=>a.amount===null&&a.type!=='fold'&&a.type!=='check')){scheduleActionAmounts(actionCrop,machine.state.actions,machine.handId,key);} else machine.actionMisses=0;
    actionAbs=rects.map((r)=>({x:layout.action.x*frame.w+(r.x/actionCrop.w)*layout.action.w*frame.w,y:layout.action.y*frame.h+(r.y/actionCrop.h)*layout.action.h*frame.h,w:(r.w/actionCrop.w)*layout.action.w*frame.w,h:(r.h/actionCrop.h)*layout.action.h*frame.h}));
  } else if(actionPresent){ if(machine.missActions(machine.handId,3)){actionPresent=false;lastActionKey='';lastDecisionKey='';render();} }
  if(frame.seq%3===0)schedulePotRead(frame.canvas,machine.handId); drawOverlay(frame,heroAbs,boardAbs,actionAbs);
});
render();

import { activeHandMachine } from '../core/state-machine.js';
import { ActionTimeline } from '../core/action-timeline.js';
import { ActionObserver } from '../vision/action-observer.js';
import { OpponentStatsStore } from './opponent-stats.js';
import { buildProCoachReport } from './pro-coach.js';

const AGGRO = new Set(['bet', 'raise', 'allin']);
const timeline = new ActionTimeline();
const observer = new ActionObserver();
const stats = new OpponentStatsStore();
let lastHandId = 0;
let idlePending = false;
let lastToken = observer.accessToken || '';
let lastUiKey = '';

function $(id) { return document.getElementById(id); }

function visibleSource() {
  const video = $('video');
  if (video && video.style.display !== 'none' && video.readyState >= 2 && video.videoWidth > 0) return video;
  const image = $('image');
  if (image && image.style.display !== 'none' && image.complete && image.naturalWidth > 0) return image;
  return null;
}

function snapshotSource(source, maxWidth = 900) {
  const sw = source.videoWidth || source.naturalWidth || source.width || 0;
  const sh = source.videoHeight || source.naturalHeight || source.height || 0;
  if (!sw || !sh) return null;
  const scale = Math.min(1, maxWidth / sw);
  const c = document.createElement('canvas');
  c.width = Math.max(320, Math.round(sw * scale));
  c.height = Math.max(180, Math.round(sh * scale));
  const ctx = c.getContext('2d');
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

function syncToken() {
  let token = '';
  try { token = sessionStorage.getItem('prc.vision-token') || ''; } catch {}
  if (token === lastToken) return;
  lastToken = token;
  observer.setAccessToken(token);
}

function rotateHand(machine) {
  if (machine.handId === lastHandId) return;
  if (timeline.handId > 0 && timeline.events.length) stats.observeHand(timeline.handId, timeline.events);
  lastHandId = machine.handId;
  if (machine.handId <= 0) {
    timeline.resetSession();
    stats.resetSession();
    observer.resetSession();
  } else {
    timeline.resetHand(machine.handId);
    observer.resetHand();
  }
  lastUiKey = '';
}

function appendObservedEvents(out, handId) {
  if (!out || handId !== activeHandMachine?.handId) return 0;
  let added = 0;
  for (const e of out.events || []) {
    if (!['preflop','flop','turn','river'].includes(e.street)) continue;
    if ((e.confidence || 0) < 0.55) continue;
    if (timeline.append({
      handId,
      street: e.street,
      actorName: e.actorName,
      seatLabel: null,
      action: e.action,
      amount: Number.isFinite(e.amount) ? e.amount : null,
      source: 'vision-action-log',
      confidence: e.confidence,
      observedAt: performance.now(),
    })) added++;
  }
  return added;
}

function maybeObserve(machine) {
  const source = visibleSource();
  if (!source || idlePending || !observer.shouldRead(machine.handId, machine.state.street)) return;
  const handId = machine.handId;
  const street = machine.state.street;
  idlePending = true;
  const run = () => {
    idlePending = false;
    if (!activeHandMachine || activeHandMachine.handId !== handId) return;
    const frozen = snapshotSource(source);
    if (!frozen) return;
    const fingerprint = `${street}:${Math.round((source.currentTime || 0) * 2)}`;
    observer.read(frozen, handId, street, { fingerprint }).then((out) => {
      if (appendObservedEvents(out, handId)) renderCoach(activeHandMachine);
    });
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 450 });
  else setTimeout(run, 0);
}

function latestVillainContext(state) {
  const sameStreet = timeline.events.filter((e) => e.street === state.street);
  const latestAggro = [...sameStreet].reverse().find((e) => AGGRO.has(e.action)) || null;
  const actorName = latestAggro?.actorName || null;
  let potBefore = null;
  const call = state.actions?.find((a) => a.type === 'call')?.amount;
  if (latestAggro?.action === 'bet' && Number.isFinite(call) && Number.isFinite(state.pot) && state.pot > call)
    potBefore = state.pot - call;
  return { actorName, latestAggro, potBefore };
}

function ensureProUi() {
  if ($('proOpponentBox')) return;
  const actions = $('actions');
  if (!actions?.parentElement) return;
  const box = document.createElement('div');
  box.id = 'proOpponentBox';
  box.className = 'pro-opponent-box';
  box.innerHTML = '<span class="eyebrow">LEITURA DO RIVAL</span><strong id="proOpponentTitle">Aguardando ações</strong><div id="proOpponentMeta">Range oculto · inferência somente pelo replay</div><small id="proOpponentReasons"></small>';
  actions.insertAdjacentElement('afterend', box);
  if (!$('proCoachStyles')) {
    const style = document.createElement('style');
    style.id = 'proCoachStyles';
    style.textContent = '.pro-opponent-box{margin-top:12px;border:1px solid #2c373c;border-radius:10px;background:#0b1113;padding:12px}.pro-opponent-box strong{display:block;margin-top:6px;font-size:15px}.pro-opponent-box div{margin-top:4px;color:#8fa0a5;font-size:11px}.pro-opponent-box small{display:block;margin-top:7px;color:#6f8187;line-height:1.4}.pro-opponent-box.live{border-color:#355548;background:#0d1713}';
    document.head.appendChild(style);
  }
}

function combinedConfidence(report, state) {
  const cardConfs = [...(state.hero || []), ...(state.board || [])].map((c) => c.confidence || 0).filter(Boolean);
  const cardConf = cardConfs.length ? cardConfs.reduce((a, b) => a + b, 0) / cardConfs.length : 0;
  if (!report.confidence) return Math.round(cardConf * 100);
  return Math.round(report.confidence * 0.65 + cardConf * 100 * 0.35);
}

function renderCoach(machine) {
  if (!machine) return;
  ensureProUi();
  const state = machine.state;
  const { actorName, potBefore } = latestVillainContext(state);
  const playerStats = actorName ? stats.snapshot(actorName) : null;
  const report = buildProCoachReport({
    state,
    events: timeline.events,
    actorName,
    potBefore,
    opponentStats: playerStats,
  });

  const opp = report.opponent;
  const box = $('proOpponentBox');
  const title = $('proOpponentTitle');
  const meta = $('proOpponentMeta');
  const reasons = $('proOpponentReasons');
  if (box && title && meta && reasons) {
    const live = actorName && opp?.confidence >= 45;
    box.classList.toggle('live', !!live);
    if (!actorName) {
      title.textContent = observer.accessToken ? 'Aguardando linha do rival' : 'Ative a Vision para ler o histórico';
      meta.textContent = 'Cartas do rival sempre ocultas · range por ações';
      reasons.textContent = observer.lastError ? `Observer: ${observer.lastError}` : 'O Coach nunca presume a mão exata do adversário.';
    } else {
      title.textContent = opp?.label || 'INCONCLUSIVO';
      meta.textContent = `${actorName} · confiança ${opp?.confidence || 0}% · ${report.rangeMix?.label || 'range em construção'}`;
      reasons.textContent = (opp?.reasons || []).slice(-2).join(' · ') || 'Acumulando ações da mão.';
    }
  }

  if (!state.heroToAct) return;
  const decision = $('decisionText');
  const reason = $('decisionReason');
  const details = $('decisionDetails');
  const confidence = $('confidence');
  if (!decision || !reason || !details || !confidence) return;

  const key = `${machine.handId}:${state.street}:${report.decision || '-'}:${actorName || '-'}:${timeline.events.length}:${Math.round((report.rangeMix?.bluffShare || 0) * 100)}`;
  if (key === lastUiKey) return;
  lastUiKey = key;

  decision.textContent = report.decision || 'LEITURA INSUFICIENTE';
  reason.textContent = report.reason || 'Aguardando estado confiável.';
  const prioritized = [];
  if (actorName && opp?.confidence >= 45) prioritized.push(`Rival: ${opp.label.toLowerCase()}.`);
  if (Number.isFinite(report.math?.potOdds)) prioritized.push(`Preço do call: ~${Math.round(report.math.potOdds * 100)}%.`);
  for (const f of report.blockers?.features || []) if (prioritized.length < 3) prioritized.push(`Blocker: ${f}.`);
  for (const d of report.details || []) if (prioritized.length < 4 && !prioritized.includes(d)) prioritized.push(d);
  details.textContent = prioritized.slice(0, 4).join(' · ');
  const conf = combinedConfidence(report, state);
  confidence.textContent = conf ? `${conf}%` : '—';
}

function tick() {
  syncToken();
  const machine = activeHandMachine;
  if (!machine) return;
  rotateHand(machine);
  if (machine.handId > 0) maybeObserve(machine);
  renderCoach(machine);
}

setInterval(tick, 250);
setTimeout(tick, 0);

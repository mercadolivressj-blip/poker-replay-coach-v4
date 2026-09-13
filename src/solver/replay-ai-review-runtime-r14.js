import { activeHandMachine } from '../core/state-machine.js';
import { activeActionTimeline } from '../core/action-timeline.js';
import { activeTableStateTracker } from '../core/table-state-tracker.js';
import { decisionStateKey, getDecision } from '../core/decision-store.js';

const LABEL = { fold:'DESISTIR', check:'PASSAR', call:'PAGAR', bet:'APOSTAR', raise:'AUMENTAR', allin:'ALL-IN', insufficient:'LEITURA INSUFICIENTE' };
const diagnostics = { enabled:true, reviewing:false, reviews:0, failures:0, lastMs:null, lastDecision:null, lastError:null, lastFingerprint:null };

function now(){ return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
function replayGuard(){ return typeof window !== 'undefined' ? window.__prcReplayOnlyR14 : null; }
function fastDecision(machine){
  const d = typeof window !== 'undefined' ? window.__prcAIDecisionR14 : null;
  if (!d || Number(d.handId) !== Number(machine?.handId)) return null;
  const age = Number.isFinite(Number(d.lastSeenAt)) && Number(d.lastSeenAt) > 0 ? now() - Number(d.lastSeenAt) : Infinity;
  const freshness = Math.max(5000, Math.min(9000, (Number(d.lastLatencyMs) || 0) * 2 + 1800));
  return age <= freshness ? d : null;
}
function mergeActions(machine, fast){
  const local = (machine?.state?.actions || []).map((a)=>({ type:a.type, amount:Number.isFinite(a.amount)?a.amount:null }));
  const ai = (fast?.actions || []).map((a)=>({ type:a.type, amount:Number.isFinite(a.amount)?a.amount:null }));
  const byType = new Map(local.map((a)=>[a.type,{...a}]));
  for (const action of ai){
    const current = byType.get(action.type);
    if (!current) byType.set(action.type,{...action});
    else if (!Number.isFinite(current.amount) && Number.isFinite(action.amount)) current.amount = action.amount;
  }
  return [...byType.values()];
}
function tableSnapshot(machine){
  const table = activeTableStateTracker?.latest;
  if (!table || Number(table.handId) !== Number(machine?.handId)) return null;
  const seats = Array.isArray(table.seats) ? table.seats.map((s)=>({
    seatIndex:s.seatIndex, actorName:s.actorName||null, position:s.position||null,
    stack:Number.isFinite(s.stack)?s.stack:null, committed:Number.isFinite(s.committed)?s.committed:null,
    dealer:Boolean(s.dealer), folded:typeof s.folded === 'boolean'?s.folded:null, hero:Boolean(s.hero),
    confidence:Number.isFinite(s.confidence)?s.confidence:null,
  })) : [];
  const hero = seats.find((s)=>s.hero) || null;
  const villains = seats.filter((s)=>!s.hero && s.folded !== true && Number.isFinite(s.stack));
  const villain = villains.length === 1 ? villains[0] : null;
  return {
    confidence:Number.isFinite(table.confidence)?table.confidence:0,
    heroPosition:table.heroPosition || hero?.position || null,
    effectiveStack:Number.isFinite(hero?.stack) && Number.isFinite(villain?.stack) ? Math.min(hero.stack,villain.stack) : null,
    seats,
  };
}
function currentReplayState(){
  const machine = activeHandMachine;
  if (!machine || machine.handId <= 0) return { error:'Ainda não há uma mão reconstruída.' };
  const guard = replayGuard();
  if (!guard?.fileReady || !['video-file','image-file'].includes(guard.sourceKind)) return { error:'Abra um vídeo ou imagem de replay gravado.' };
  const hero = machine.state.hero || [];
  if (hero.length !== 2 || hero.some((c)=>!c?.rank || !c?.suit)) return { error:'Informe manualmente suas duas cartas antes da revisão.' };

  const video = document.getElementById('video');
  const image = document.getElementById('image');
  const imageVisible = image && image.style.display !== 'none' && image.complete && image.naturalWidth > 0;
  const videoVisible = video && video.style.display !== 'none' && video.readyState >= 2 && video.videoWidth > 0;
  if (!imageVisible && !videoVisible) return { error:'O replay ainda não está visível.' };
  if (videoVisible && !video.paused) video.pause();

  const fast = fastDecision(machine);
  if (!Boolean(machine.state.heroToAct || fast?.heroToAct === true)) return { error:'Pare o replay em um ponto em que seja a sua vez de agir.' };
  const actions = mergeActions(machine,fast);
  if (!actions.length) return { error:'Ainda não consegui reconstruir as ações disponíveis nesse ponto.' };

  const stateKey = decisionStateKey(machine.handId,machine.state);
  const baseline = getDecision(stateKey) || getDecision();
  const events = activeActionTimeline?.handId === machine.handId ? activeActionTimeline.events.map((e)=>({...e})) : [];
  return { value:{
    mode:'replay-file-review', paused:true, sourceKind:guard.sourceKind, handId:machine.handId,
    fingerprint:`r14-review:${stateKey}`, street:machine.state.street,
    hero:hero.map((c)=>({rank:c.rank,suit:c.suit})),
    board:(machine.state.board||[]).map((c)=>({rank:c.rank,suit:c.suit})),
    pot:Number.isFinite(fast?.pot)?fast.pot:(Number.isFinite(machine.state.pot)?machine.state.pot:null),
    actions, events, table:tableSnapshot(machine),
    baseline:baseline?{ decision:baseline.decision||null, reason:baseline.reason||null, confidence:Number.isFinite(baseline.confidence)?baseline.confidence:null, source:baseline.source||null }:null,
  }};
}
function ensurePanel(){
  let panel = document.getElementById('replayAIReviewR14');
  if (panel) return panel;
  const coach = document.querySelector('.coach-card');
  if (!coach) return null;
  panel = document.createElement('section');
  panel.id = 'replayAIReviewR14'; panel.className = 'replay-ai-review-r14';
  panel.innerHTML = `<div class="replay-ai-review-head"><div><span class="eyebrow">GPT-5.6 SOL · REPLAY PAUSADO</span><strong>Revisão sênior da decisão</strong></div><button id="replayAIReviewBtn" type="button">Analisar este ponto com IA</button></div><div id="replayAIReviewDecision" class="replay-ai-review-decision">—</div><div id="replayAIReviewReason" class="replay-ai-review-reason">Abra um replay por arquivo, informe suas cartas e pause na sua vez.</div><div id="replayAIReviewDetails" class="replay-ai-review-details"></div>`;
  coach.append(panel);
  if (!document.getElementById('replayAIReviewStylesR14')){
    const style=document.createElement('style'); style.id='replayAIReviewStylesR14';
    style.textContent='.replay-ai-review-r14{margin-top:14px;border:1px solid #334047;border-radius:12px;background:#0b1113;padding:12px}.replay-ai-review-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.replay-ai-review-head strong{display:block;margin-top:3px;font-size:13px}.replay-ai-review-head button{border:0;border-radius:9px;padding:9px 11px;font-weight:700;cursor:pointer;background:#e7c65a;color:#111}.replay-ai-review-head button:disabled{cursor:not-allowed;opacity:.45}.replay-ai-review-decision{margin-top:11px;font-size:22px;font-weight:900;color:#63d49a}.replay-ai-review-reason{margin-top:5px;font-size:12px;line-height:1.4;color:#d8e0e2}.replay-ai-review-details{margin-top:7px;font-size:10px;line-height:1.45;color:#92a1a6;white-space:pre-wrap}';
    document.head.append(style);
  }
  document.getElementById('replayAIReviewBtn')?.addEventListener('click',()=>void reviewCurrentPoint());
  return panel;
}
function renderResult(out){
  const decision=document.getElementById('replayAIReviewDecision'), reason=document.getElementById('replayAIReviewReason'), details=document.getElementById('replayAIReviewDetails');
  if (!decision || !reason || !details) return;
  decision.textContent=LABEL[out?.decision]||'LEITURA INSUFICIENTE'; reason.textContent=out?.reason||'A IA não conseguiu concluir a revisão deste ponto.';
  const factors=Array.isArray(out?.keyFactors)&&out.keyFactors.length?`Fatores: ${out.keyFactors.join(' · ')}`:'';
  const uncertainties=Array.isArray(out?.uncertainties)&&out.uncertainties.length?`\nIncertezas: ${out.uncertainties.join(' · ')}`:'';
  details.textContent=`${out?.details||''}${factors?`\n${factors}`:''}${uncertainties}\nConfiança: ${Math.round(Number(out?.confidence)||0)}% · GPT-5.6 Sol · ${Math.round(Number(out?.ms)||0)}ms`.trim();
}
async function reviewCurrentPoint(){
  ensurePanel();
  const button=document.getElementById('replayAIReviewBtn'), decision=document.getElementById('replayAIReviewDecision'), reason=document.getElementById('replayAIReviewReason'), details=document.getElementById('replayAIReviewDetails');
  if (!button || !decision || !reason || !details || diagnostics.reviewing) return;
  const snapshot=currentReplayState();
  if (snapshot.error){ decision.textContent='—'; reason.textContent=snapshot.error; details.textContent=''; return; }
  diagnostics.reviewing=true; diagnostics.lastError=null; button.disabled=true; button.textContent='GPT-5.6 Sol analisando…'; decision.textContent='ANALISANDO'; reason.textContent='Revisando posição, linha, sizing, pote, board e alternativas deste ponto do replay.'; details.textContent='O vídeo foi pausado para congelar o estado analisado.';
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),15500);
  try{
    const r=await fetch('/api/coach-review-r14',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(snapshot.value),signal:controller.signal});
    const out=await r.json().catch(()=>({})); if(!r.ok) throw new Error(out?.error||`HTTP ${r.status}`);
    if(Number(out.handId)!==Number(snapshot.value.handId)||out.fingerprint!==snapshot.value.fingerprint) throw new Error('a mão mudou antes de a revisão terminar');
    diagnostics.reviews++; diagnostics.lastMs=Number(out.ms)||null; diagnostics.lastDecision=out.decision||null; diagnostics.lastFingerprint=out.fingerprint||null; renderResult(out);
  }catch(e){
    diagnostics.failures++; diagnostics.lastError=e?.name==='AbortError'?'timeout da revisão IA':String(e?.message||'falha na revisão IA'); decision.textContent='LEITURA INSUFICIENTE'; reason.textContent=`A revisão com GPT-5.6 Sol falhou: ${diagnostics.lastError}.`; details.textContent='O baseline local continua visível acima; tente novamente com o replay pausado no mesmo ponto.';
  }finally{ clearTimeout(timer); diagnostics.reviewing=false; button.disabled=false; button.textContent='Analisar este ponto com IA'; }
}
function refreshAvailability(){
  ensurePanel(); const button=document.getElementById('replayAIReviewBtn'); if(!button||diagnostics.reviewing)return;
  const guard=replayGuard(), machine=activeHandMachine; const heroReady=machine?.state?.hero?.length===2&&machine.state.hero.every((c)=>c?.rank&&c?.suit);
  button.disabled=!guard?.fileReady||!heroReady||!(machine?.handId>0);
}
if(typeof window!=='undefined'){
  window.__prcReplayAIReviewR14={diagnostics,reviewCurrentPoint,currentReplayState};
  window.addEventListener('prc:generation-change',()=>{ diagnostics.lastDecision=null; diagnostics.lastFingerprint=null; const d=document.getElementById('replayAIReviewDecision'),r=document.getElementById('replayAIReviewReason'),x=document.getElementById('replayAIReviewDetails'); if(d)d.textContent='—'; if(r)r.textContent='Nova mão detectada. Pause no ponto que deseja revisar.'; if(x)x.textContent=''; });
  window.addEventListener('prc:replay-file-source',refreshAvailability); setInterval(refreshAvailability,250); setTimeout(refreshAvailability,0);
}

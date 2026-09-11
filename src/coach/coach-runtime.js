import { activeHandMachine } from '../core/state-machine.js';
import { ActionTimeline } from '../core/action-timeline.js';
import { TableStateTracker } from '../core/table-state-tracker.js';
import { ActionObserver } from '../vision/action-observer.js';
import { TableObserver } from '../vision/table-observer.js';
import { OpponentStatsStore } from './opponent-stats.js';
import { buildProCoachReport } from './pro-coach.js';
import { ReasoningBrain, buildReasoningPayload } from './reasoning-brain.js';

const AGGRO = new Set(['bet', 'raise', 'allin']);
const timeline = new ActionTimeline();
const observer = new ActionObserver();
const tableObserver = new TableObserver();
const tableTracker = new TableStateTracker();
const brain = new ReasoningBrain();
const stats = new OpponentStatsStore();
let lastHandId = 0;
let idlePending = false;
let tableIdlePending = false;
let lastToken = observer.accessToken || '';
let lastUiKey = '';

const DECISION_LABEL = {
  fold: 'DESISTIR',
  check: 'PASSAR',
  call: 'PAGAR',
  bet: 'APOSTAR',
  raise: 'AUMENTAR',
  allin: 'ALL-IN',
  insufficient: 'LEITURA INSUFICIENTE',
};

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
  tableObserver.setAccessToken(token);
  brain.setAccessToken(token);
}

function rotateHand(machine) {
  if (machine.handId === lastHandId) return;
  if (timeline.handId > 0 && timeline.events.length) stats.observeHand(timeline.handId, timeline.events);
  lastHandId = machine.handId;
  if (machine.handId <= 0) {
    timeline.resetSession();
    tableTracker.resetSession();
    stats.resetSession();
    observer.resetSession();
    tableObserver.resetSession();
    brain.resetSession();
  } else {
    timeline.resetHand(machine.handId);
    tableTracker.resetHand(machine.handId);
    observer.resetHand();
    tableObserver.resetHand();
    brain.resetHand();
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

function appendTableEvents(events, handId) {
  if (!Number.isInteger(handId) || handId !== activeHandMachine?.handId) return 0;
  let added = 0;
  for (const e of events || []) {
    if ((e.confidence || 0) < 0.6) continue;
    if (timeline.append({
      handId,
      street: e.street,
      actorName: e.actorName,
      seatLabel: e.seatLabel,
      action: e.action,
      amount: Number.isFinite(e.amount) ? e.amount : null,
      source: e.source || 'table-diff',
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

function maybeObserveTable(machine) {
  const source = visibleSource();
  if (!source || tableIdlePending || !tableObserver.shouldRead(machine.handId)) return;
  const handId = machine.handId;
  const street = machine.state.street;
  tableIdlePending = true;
  const run = () => {
    tableIdlePending = false;
    if (!activeHandMachine || activeHandMachine.handId !== handId) return;
    const frozen = snapshotSource(source, 1050);
    if (!frozen) return;
    const fingerprint = `${street}:${Math.round((source.currentTime || 0) * 2)}`;
    tableObserver.read(frozen, handId, street, { fingerprint }).then((out) => {
      if (!out || !activeHandMachine || activeHandMachine.handId !== handId) return;
      const result = tableTracker.ingest(out);
      if (!result.accepted) return;
      appendTableEvents(result.events, handId);
      renderCoach(activeHandMachine);
    });
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 650 });
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
  if (!$('proOpponentBox')) {
    const actions = $('actions');
    if (actions?.parentElement) {
      const box = document.createElement('div');
      box.id = 'proOpponentBox';
      box.className = 'pro-opponent-box';
      box.innerHTML = '<span class="eyebrow">LEITURA DO RIVAL</span><strong id="proOpponentTitle">Aguardando ações</strong><div id="proOpponentMeta">Range oculto · inferência somente pelo replay</div><small id="proOpponentReasons"></small>';
      actions.insertAdjacentElement('afterend', box);
    }
  }
  if (!$('brainStatus')) {
    const decisionBox = document.querySelector('.decision-box');
    const eyebrow = decisionBox?.querySelector('.eyebrow');
    if (eyebrow) {
      const badge = document.createElement('span');
      badge.id = 'brainStatus';
      badge.className = 'brain-status';
      badge.textContent = 'RÁPIDO';
      eyebrow.insertAdjacentElement('afterend', badge);
    }
  }
  if (!$('proCoachStyles')) {
    const style = document.createElement('style');
    style.id = 'proCoachStyles';
    style.textContent = '.pro-opponent-box{margin-top:12px;border:1px solid #2c373c;border-radius:10px;background:#0b1113;padding:12px}.pro-opponent-box strong{display:block;margin-top:6px;font-size:15px}.pro-opponent-box div{margin-top:4px;color:#8fa0a5;font-size:11px}.pro-opponent-box small{display:block;margin-top:7px;color:#6f8187;line-height:1.4}.pro-opponent-box.live{border-color:#355548;background:#0d1713}.brain-status{float:right;margin-top:-2px;padding:3px 7px;border:1px solid #344147;border-radius:999px;color:#819197;font-size:9px;font-weight:900;letter-spacing:.08em}.brain-status.thinking{color:#f2c44f;border-color:#66572c}.brain-status.ready{color:#63d49a;border-color:#27583e;background:#10271c}.brain-status.error{color:#ee8b86;border-color:#633735}';
    document.head.appendChild(style);
  }
}

function cardConfidence(state) {
  const cardConfs = [...(state.hero || []), ...(state.board || [])].map((c) => c.confidence || 0).filter(Boolean);
  return cardConfs.length ? cardConfs.reduce((a, b) => a + b, 0) / cardConfs.length : 0;
}

function combinedConfidence(report, state) {
  const cardConf = cardConfidence(state);
  if (!report.confidence) return Math.round(cardConf * 100);
  return Math.round(report.confidence * 0.65 + cardConf * 100 * 0.35);
}

function dynamicConfidence(dynamic, state) {
  const cardConf = cardConfidence(state) * 100;
  const reasoning = Number(dynamic?.confidence) || 0;
  const dataQuality = Number(dynamic?.dataQuality) || 0;
  return Math.round(reasoning * 0.62 + dataQuality * 0.2 + cardConf * 0.18);
}

function baselineForReasoning(report) {
  if (!report) return null;
  return {
    decision: report.decision,
    reason: report.reason,
    confidence: report.confidence,
    boardProfile: report.boardProfile,
    blockers: report.blockers,
    math: report.math,
    opponent: report.opponent,
    rangeMix: report.rangeMix,
  };
}

function reasoningContext(machine, report, actorName, potBefore, playerStats) {
  return buildReasoningPayload({
    handId: machine.handId,
    state: machine.state,
    events: timeline.events,
    actorName,
    potBefore,
    opponentStats: playerStats,
    baseline: baselineForReasoning(report),
    tableState: tableTracker.latest,
  });
}

function maybeReason(machine, payload) {
  if (!machine.state.heroToAct || !payload?.fingerprint) return;
  if (brain.cached(payload.fingerprint)) return;
  if (brain.busy && brain.activeFingerprint === payload.fingerprint) return;
  brain.read(payload).then((out) => {
    if (!out || !activeHandMachine || activeHandMachine.handId !== machine.handId) return;
    renderCoach(activeHandMachine);
  });
}

function renderOpponent(report, actorName) {
  const opp = report.opponent;
  const box = $('proOpponentBox');
  const title = $('proOpponentTitle');
  const meta = $('proOpponentMeta');
  const reasons = $('proOpponentReasons');
  if (!box || !title || !meta || !reasons) return;
  const live = actorName && opp?.confidence >= 45;
  box.classList.toggle('live', !!live);
  const heroPosition = tableTracker.latest?.heroPosition;
  if (!actorName) {
    title.textContent = observer.accessToken ? 'Aguardando linha do rival' : 'Ative a Vision para ler o histórico';
    meta.textContent = `Cartas do rival sempre ocultas · ${heroPosition ? `Hero ${heroPosition}` : 'posição em leitura'}`;
    reasons.textContent = observer.lastError || tableObserver.lastError ? `Observer: ${observer.lastError || tableObserver.lastError}` : 'O Coach nunca presume a mão exata do adversário.';
  } else {
    title.textContent = opp?.label || 'INCONCLUSIVO';
    meta.textContent = `${actorName} · confiança ${opp?.confidence || 0}% · ${report.rangeMix?.label || 'range em construção'}${heroPosition ? ` · Hero ${heroPosition}` : ''}`;
    reasons.textContent = (opp?.reasons || []).slice(-2).join(' · ') || 'Acumulando ações da mão.';
  }
}

function renderDecision(machine, report, actorName, payload) {
  if (!machine.state.heroToAct) return;
  const state = machine.state;
  const dynamic = brain.cached(payload.fingerprint);
  const decision = $('decisionText');
  const reason = $('decisionReason');
  const details = $('decisionDetails');
  const confidence = $('confidence');
  const badge = $('brainStatus');
  if (!decision || !reason || !details || !confidence) return;

  const key = `${machine.handId}:${state.street}:${payload.fingerprint}:${dynamic?.decision || report.decision || '-'}:${dynamic?.confidence || 0}`;
  if (key === lastUiKey) {
    if (badge && !dynamic) {
      badge.textContent = brain.busy ? 'CÉREBRO PENSANDO' : (brain.lastError ? 'CÉREBRO OFF' : 'RÁPIDO');
      badge.className = `brain-status ${brain.busy ? 'thinking' : brain.lastError ? 'error' : ''}`;
    }
    return;
  }
  lastUiKey = key;

  if (dynamic) {
    const label = DECISION_LABEL[dynamic.decision] || 'LEITURA INSUFICIENTE';
    decision.textContent = label;
    reason.textContent = dynamic.rationale || dynamic.headline || 'Análise dinâmica concluída.';
    const factors = [...(dynamic.keyFactors || [])].slice(0, 3);
    if (dynamic.opponentRange?.shape && dynamic.opponentRange.shape !== 'unknown') factors.unshift(`Range: ${dynamic.opponentRange.shape}.`);
    if (dynamic.uncertainties?.length && factors.length < 4) factors.push(`Incerteza: ${dynamic.uncertainties[0]}`);
    details.textContent = factors.slice(0, 4).join(' · ');
    confidence.textContent = `${dynamicConfidence(dynamic, state)}%`;
    if (badge) { badge.textContent = `CÉREBRO · ${dynamic.ms || 0}ms`; badge.className = 'brain-status ready'; }
    return;
  }

  decision.textContent = report.decision || 'LEITURA INSUFICIENTE';
  reason.textContent = report.reason || 'Aguardando estado confiável.';
  const prioritized = [];
  const opp = report.opponent;
  if (actorName && opp?.confidence >= 45) prioritized.push(`Rival: ${opp.label.toLowerCase()}.`);
  if (Number.isFinite(report.math?.potOdds)) prioritized.push(`Preço do call: ~${Math.round(report.math.potOdds * 100)}%.`);
  for (const f of report.blockers?.features || []) if (prioritized.length < 3) prioritized.push(`Blocker: ${f}.`);
  for (const d of report.details || []) if (prioritized.length < 4 && !prioritized.includes(d)) prioritized.push(d);
  details.textContent = prioritized.slice(0, 4).join(' · ');
  const conf = combinedConfidence(report, state);
  confidence.textContent = conf ? `${conf}%` : '—';
  if (badge) {
    badge.textContent = brain.busy ? 'CÉREBRO PENSANDO' : (brain.lastError ? 'CÉREBRO OFF' : 'RÁPIDO');
    badge.className = `brain-status ${brain.busy ? 'thinking' : brain.lastError ? 'error' : ''}`;
  }
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
  renderOpponent(report, actorName);
  if (!state.heroToAct) return;

  const payload = reasoningContext(machine, report, actorName, potBefore, playerStats);
  renderDecision(machine, report, actorName, payload);
  maybeReason(machine, payload);
}

function tick() {
  syncToken();
  const machine = activeHandMachine;
  if (!machine) return;
  rotateHand(machine);
  if (machine.handId > 0) {
    maybeObserve(machine);
    maybeObserveTable(machine);
  }
  renderCoach(machine);
}

setInterval(tick, 250);
setTimeout(tick, 0);

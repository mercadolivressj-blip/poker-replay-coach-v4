import { cardId } from './hand-evaluator.js';
import { buildOpponentRange } from './range-engine.js';
import { estimateEquity, estimateMultiwayEquity } from './equity-engine.js';
import { estimateActionValues, valueGap } from './value-engine.js';
import { actorKey, canonicalActorName, engagedOpponentNames, resolveAggressorEvidence } from '../core/poker-evidence-r14.js';

function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function eventKey(e) { return `${e?.street || '-'}:${e?.actorName || '-'}:${e?.action || '-'}:${Number.isFinite(e?.amount) ? Math.round(e.amount * 100) / 100 : '-'}`; }
function seatKey(s) { return `${s?.seatIndex ?? '-'}:${s?.actorName || '-'}:${s?.position || '-'}:${Number.isFinite(s?.stack) ? Math.round(s.stack * 100) / 100 : '-'}:${Number.isFinite(s?.committed) ? Math.round(s.committed * 100) / 100 : '-'}:${s?.folded === true ? 'F' : 'A'}`; }

export function resolverFingerprint({ handId, state, events = [], actorName = null, table = null } = {}) {
  const hero = (state?.hero || []).map(cardId).join(',');
  const board = (state?.board || []).map(cardId).join(',');
  const history = events.slice(-24).map(eventKey).join('>');
  const seats = (table?.seats || []).map(seatKey).join('|');
  return [handId || 0, state?.street || '-', hero, board, Number.isFinite(state?.pot) ? Math.round(state.pot * 100) / 100 : '-', actorName || '-', history, table?.heroPosition || '-', Number.isFinite(table?.effectiveStack) ? Math.round(table.effectiveStack * 100) / 100 : '-', seats].join('#').slice(0, 1800);
}

function heroName(table) {
  return table?.seats?.find((seat) => seat.hero)?.actorName || null;
}

function primaryActorFor(context) {
  const seats = context?.table?.seats || [];
  const proposed = canonicalActorName(context?.actorName, seats);
  if (proposed) return proposed;

  const heroSeat = seats.find((seat) => seat.hero);
  const fallback = resolveAggressorEvidence({
    proposedName: context?.actorName,
    heroCommitted: Number.isFinite(heroSeat?.committed) ? heroSeat.committed : null,
    seats,
  });
  if (fallback?.actorName) return fallback.actorName;

  for (const event of [...(context?.events || [])].reverse()) {
    if (!['bet','raise','allin'].includes(event?.action)) continue;
    const canonical = canonicalActorName(event?.actorName, seats);
    if (canonical) return canonical;
  }
  return null;
}

function activeActors(context, primaryActor) {
  const table = context?.table;
  const names = engagedOpponentNames({
    seats: table?.seats || [],
    events: context?.events || [],
    heroName: heroName(table),
    primaryActor,
    street: context?.state?.street || 'preflop',
  });
  if (names.length) return names;
  return primaryActor ? [primaryActor] : [];
}

function aggregateSummary(ranges) {
  const summaries = (ranges || []).map((range) => range?.summary).filter(Boolean);
  if (!summaries.length) return null;
  const avg = (key) => summaries.reduce((sum, item) => sum + (Number(item[key]) || 0), 0) / summaries.length;
  return {
    strongShare: avg('strongShare'),
    drawShare: avg('drawShare'),
    airShare: avg('airShare'),
    comboCount: summaries.reduce((sum, item) => sum + (Number(item.comboCount) || 0), 0),
    rangeCount: summaries.length,
  };
}

function evidenceMetrics(context, equity, actors, primaryActor) {
  const events = context.events || [];
  const actorKeys = new Set((actors || []).map(actorKey).filter(Boolean));
  const relevant = actorKeys.size ? events.filter((event) => actorKeys.has(actorKey(event.actorName))) : events;
  const eventConf = relevant.length ? relevant.reduce((sum, event) => sum + clamp(Number(event.confidence) || 0.55, 0, 1), 0) / relevant.length : 0;
  const eventCoverage = Math.min(1, relevant.length / Math.max(2, actorKeys.size * 2 || 2));
  const tableConf = clamp(Number(context.table?.confidence) || 0, 0, 1);
  const sampleCertainty = equity?.stderr === 0 ? 1 : clamp(1 - (Number(equity?.stderr) || 0.2) * 8, 0, 1);
  const actorKnown = Boolean(primaryActor);
  const primaryKey = actorKey(primaryActor);
  const primarySeat = (context.table?.seats || []).find((seat) => actorKey(seat?.actorName) === primaryKey);
  const heroSeat = (context.table?.seats || []).find((seat) => seat?.hero);
  const heroCommit = Number.isFinite(heroSeat?.committed) ? heroSeat.committed : 0;
  const actorCurrentFrameConfirmed = Boolean(primarySeat && primarySeat.folded !== true && (
    ['bet','raise','allin'].includes(primarySeat.visibleAction)
    || (Number.isFinite(primarySeat.committed) && primarySeat.committed > heroCommit + 0.0005)
  ));
  const actorEventCount = primaryActor ? events.filter((event) => actorKey(event.actorName) === primaryKey).length : 0;
  const actorEvidence = actorEventCount > 0 || actorCurrentFrameConfirmed;
  const quality = clamp(
    eventConf * eventCoverage * 0.30 +
    tableConf * 0.20 +
    (actorKnown ? 0.14 : 0) +
    (actorEvidence ? 0.10 : 0) +
    sampleCertainty * 0.18 +
    (Number.isFinite(context.state?.pot) ? 0.08 : 0),
    0,
    1,
  );
  return {
    quality,
    eventCount: events.length,
    opponentEventCount: relevant.length,
    actorEventCount,
    actorCurrentFrameConfirmed,
    localChatCount: events.filter((event) => event.source === 'local-dealer-chat').length,
    sampleCertainty,
    actorKnown,
  };
}

export function prepareResolverState(context, { budget = 620 } = {}) {
  const t0 = now();
  const fingerprint = resolverFingerprint(context);
  const primaryActor = primaryActorFor(context);
  const actors = activeActors(context, primaryActor);
  const rangeActors = actors.length ? actors : (primaryActor ? [primaryActor] : []);
  const maxCombos = rangeActors.length > 1 ? Math.max(100, Math.floor(420 / rangeActors.length)) : 280;
  const opponentRanges = rangeActors.map((actorName) => buildOpponentRange({
    hero: context.state?.hero || [],
    board: context.state?.board || [],
    events: context.events || [],
    actorName,
    table: context.table || null,
    maxCombos,
  })).filter((range) => range.combos?.length);

  const range = opponentRanges.find((item) => actorKey(item.actorName) === actorKey(primaryActor))
    || opponentRanges[0]
    || buildOpponentRange({
      hero: context.state?.hero || [],
      board: context.state?.board || [],
      events: context.events || [],
      actorName: primaryActor,
      table: context.table || null,
      maxCombos: 280,
    });

  const equity = opponentRanges.length > 1
    ? estimateMultiwayEquity({
        hero: context.state?.hero || [],
        board: context.state?.board || [],
        ranges: opponentRanges,
        budget: Math.max(720, Math.round(budget * 1.8)),
        seed: fingerprint,
      })
    : estimateEquity({
        hero: context.state?.hero || [],
        board: context.state?.board || [],
        range,
        budget,
        seed: fingerprint,
      });

  const activeOpponents = Math.max(1, opponentRanges.length || actors.length || (primaryActor ? 1 : 0));
  const evidence = evidenceMetrics(context, equity, actors, primaryActor);
  return {
    fingerprint,
    handId: context.handId,
    street: context.state?.street,
    pot: Number.isFinite(context.state?.pot) ? context.state.pot : null,
    actorName: primaryActor,
    table: context.table || null,
    range,
    rangeSummary: aggregateSummary(opponentRanges.length ? opponentRanges : [range]),
    opponentRanges,
    opponentActors: actors,
    equity,
    activeOpponents,
    evidenceQuality: evidence.quality,
    eventCount: evidence.eventCount,
    opponentEventCount: evidence.opponentEventCount,
    actorEventCount: evidence.actorEventCount,
    actorCurrentFrameConfirmed: evidence.actorCurrentFrameConfirmed,
    localChatCount: evidence.localChatCount,
    sampleCertainty: evidence.sampleCertainty,
    actorKnown: evidence.actorKnown,
    preparedMs: now() - t0,
    preparedAt: now(),
  };
}

function explanation(best, prepared) {
  const eq = Math.round((prepared.equity?.equity || 0) * 100);
  const summary = prepared.rangeSummary || prepared.range?.summary || {};
  const strong = Math.round((summary.strongShare || 0) * 100);
  const versus = prepared.activeOpponents > 1 ? `${prepared.activeOpponents} ranges realmente envolvidos` : 'o range reconstruído';
  if (best.action === 'call') return `PAGAR: equity estimada ~${eq}% contra ${versus}; o preço observado mantém o call competitivo.`;
  if (best.action === 'fold') return `DESISTIR: o valor esperado das continuações ficou abaixo do fold; ${versus} têm ~${strong}% de região forte média neste modelo.`;
  if (best.action === 'raise' || best.action === 'bet' || best.action === 'allin') {
    const fe = Math.round((best.foldEquity || 0) * 100);
    return `${best.action === 'bet' ? 'APOSTAR' : best.action === 'raise' ? 'AUMENTAR' : 'ALL-IN'}: combina ~${eq}% de equity estimada com ~${fe}% de fold equity sustentada pelo contexto observado.`;
  }
  if (best.action === 'check') return `PASSAR: mantém o pote controlado com ~${eq}% de equity estimada sem assumir ação futura que ainda não aconteceu.`;
  return 'Estado público local resolvido.';
}

export function decidePrepared(prepared, actions = []) {
  const t0 = now();
  if (!prepared || !Number.isFinite(prepared.pot) || !Number.isFinite(prepared.equity?.equity) || !actions.length) {
    return { decision: 'insufficient', confidence: 0, reason: 'Dados insuficientes para o resolver local.', values: [], ms: now() - t0 };
  }
  const callAction = actions.find((action) => action?.type === 'call');
  if (callAction && (!prepared.actorKnown || (!prepared.actorEventCount && !prepared.actorCurrentFrameConfirmed))) {
    return { decision: 'insufficient', confidence: 0, reason: 'Ainda não confirmei qual rival gerou o preço atual; não vou recomendar call contra range genérico.', values: [], ms: now() - t0 };
  }
  if (callAction && !Number.isFinite(callAction.amount)) {
    return { decision: 'insufficient', confidence: 0, reason: 'O valor necessário para pagar ainda não foi confirmado.', values: [], ms: now() - t0 };
  }
  if (prepared.activeOpponents > 1 && (!prepared.equity?.multiway || prepared.opponentRanges?.length < 2)) {
    return { decision: 'insufficient', confidence: 0, reason: 'A mão é multiway, mas ainda não reconstruí ranges separados suficientes para calcular o call.', values: [], ms: now() - t0 };
  }

  const values = estimateActionValues({
    equity: prepared.equity.equity,
    pot: prepared.pot,
    actions,
    rangeSummary: prepared.rangeSummary || prepared.range?.summary,
    street: prepared.street,
    effectiveStack: prepared.table?.effectiveStack,
    evidenceQuality: prepared.evidenceQuality,
    actorKnown: prepared.actorKnown,
  });
  if (!values.length) return { decision: 'insufficient', confidence: 0, reason: 'Nenhuma ação pôde ser avaliada localmente.', values: [], ms: now() - t0 };

  const best = values[0];
  const scale = Math.max(1, prepared.pot + Math.max(...values.map((value) => Number(value.risk) || 0)));
  const gap = valueGap(values, scale);
  let confidence = Math.round(30 + gap * 32 + (prepared.evidenceQuality || 0) * 30 + (prepared.sampleCertainty || 0) * 8);
  if (!prepared.actorKnown) confidence = Math.min(confidence, 45);
  if (!prepared.actorEventCount && !prepared.actorCurrentFrameConfirmed && prepared.activeOpponents === 1) confidence = Math.min(confidence, 52);
  if (!prepared.actorEventCount && prepared.actorCurrentFrameConfirmed && prepared.activeOpponents === 1) confidence = Math.min(confidence, 72);
  if (prepared.activeOpponents > 1) confidence = Math.min(confidence, 78);
  confidence = clamp(confidence, 28, 94);

  const caveats = [];
  if (prepared.activeOpponents > 1) caveats.push(`equity multiway com ${prepared.opponentRanges.length} ranges realmente envolvidos`);
  if (!prepared.actorEventCount && prepared.actorCurrentFrameConfirmed) caveats.push('agressor confirmado pelo frame atual');
  if (!prepared.actorEventCount && !prepared.actorCurrentFrameConfirmed && prepared.activeOpponents === 1) caveats.push('sem ação explícita suficiente do rival principal');
  if ((prepared.rangeSummary?.comboCount || 0) < 80) caveats.push('range estreito por pouca cobertura');
  if (prepared.activeOpponents > 1 && ['bet', 'raise', 'allin'].includes(best.action)) caveats.push('fold equity multiway ainda é agregada');

  return {
    decision: best.action,
    confidence,
    reason: explanation(best, prepared),
    values,
    equity: prepared.equity.equity,
    rangeSummary: prepared.rangeSummary || prepared.range?.summary || null,
    actorName: prepared.actorName,
    opponentActors: prepared.opponentActors || [],
    opponentRanges: (prepared.opponentRanges || []).map((range) => ({ actorName: range.actorName || null, comboCount: range.summary?.comboCount || range.combos?.length || 0 })),
    activeOpponents: prepared.activeOpponents,
    eventCount: prepared.eventCount,
    actorEventCount: prepared.actorEventCount,
    actorCurrentFrameConfirmed: prepared.actorCurrentFrameConfirmed,
    localChatCount: prepared.localChatCount,
    evidenceQuality: prepared.evidenceQuality,
    fingerprint: prepared.fingerprint,
    preparedMs: prepared.preparedMs,
    ms: now() - t0,
    caveats,
    engine: prepared.activeOpponents > 1 ? 'continual-local-multiway-r14' : 'continual-local-v1',
  };
}

export class ContinualResolver {
  constructor() { this.resetSession(); }
  resetSession() { this.generation = 0; this.prepared = null; this.pendingFingerprint = null; this.lastDecision = null; }
  resetHand() { this.generation++; this.prepared = null; this.pendingFingerprint = null; this.lastDecision = null; }
  schedule(context) {
    if (!context?.state || context.state.hero?.length !== 2 || !Number.isFinite(context.state.pot)) return null;
    const fp = resolverFingerprint(context);
    if (this.prepared?.fingerprint === fp || this.pendingFingerprint === fp) return fp;
    const generation = ++this.generation;
    this.pendingFingerprint = fp;
    const run = () => {
      if (generation !== this.generation) return;
      const prepared = prepareResolverState(context, { budget: 620 });
      if (generation !== this.generation) return;
      this.prepared = prepared;
      this.pendingFingerprint = null;
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 140 });
    else setTimeout(run, 0);
    return fp;
  }
  resolve(context, actions = []) {
    const fp = resolverFingerprint(context);
    let prepared = this.prepared?.fingerprint === fp ? this.prepared : null;
    if (!prepared) prepared = prepareResolverState(context, { budget: 220 });
    const decision = decidePrepared(prepared, actions);
    this.lastDecision = decision;
    if (this.prepared?.fingerprint !== fp) this.prepared = prepared;
    return decision;
  }
}

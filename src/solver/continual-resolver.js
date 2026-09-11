import { cardId } from './hand-evaluator.js';
import { buildOpponentRange } from './range-engine.js';
import { estimateEquity } from './equity-engine.js';
import { estimateActionValues, valueGap } from './value-engine.js';

function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function eventKey(e) { return `${e?.street || '-'}:${e?.actorName || '-'}:${e?.action || '-'}:${Number.isFinite(e?.amount) ? Math.round(e.amount * 100) / 100 : '-'}`; }
function seatKey(s) { return `${s?.seatIndex ?? '-'}:${s?.actorName || '-'}:${s?.position || '-'}:${Number.isFinite(s?.stack) ? Math.round(s.stack) : '-'}:${Number.isFinite(s?.committed) ? Math.round(s.committed) : '-'}:${s?.folded === true ? 'F' : 'A'}`; }
function actorKey(name) { return String(name || '').trim().toLowerCase(); }

export function resolverFingerprint({ handId, state, events = [], actorName = null, table = null } = {}) {
  const hero = (state?.hero || []).map(cardId).join(',');
  const board = (state?.board || []).map(cardId).join(',');
  const history = events.slice(-18).map(eventKey).join('>');
  const seats = (table?.seats || []).map(seatKey).join('|');
  return [handId || 0, state?.street || '-', hero, board, Number.isFinite(state?.pot) ? Math.round(state.pot * 100) / 100 : '-', actorName || '-', history, table?.heroPosition || '-', Number.isFinite(table?.effectiveStack) ? Math.round(table.effectiveStack) : '-', seats].join('#').slice(0, 1400);
}

function activeOpponentCount(table, events = []) {
  if (table?.seats?.length) return Math.max(1, table.seats.filter((s) => !s.hero && s.folded !== true).length);
  const names = new Set(events.map((e) => actorKey(e.actorName)).filter(Boolean));
  return Math.max(1, Math.min(6, names.size || 1));
}

function evidenceMetrics(context, equity) {
  const events = context.events || [];
  const actor = actorKey(context.actorName);
  const actorEvents = actor ? events.filter((e) => actorKey(e.actorName) === actor) : [];
  const relevant = actorEvents.length ? actorEvents : events;
  const eventConf = relevant.length ? relevant.reduce((s, e) => s + clamp(Number(e.confidence) || 0.55, 0, 1), 0) / relevant.length : 0;
  const eventCoverage = Math.min(1, relevant.length / 4);
  const tableConf = clamp(Number(context.table?.confidence) || 0, 0, 1);
  const sampleCertainty = equity?.stderr === 0 ? 1 : clamp(1 - (Number(equity?.stderr) || 0.2) * 8, 0, 1);
  const actorKnown = actor ? 1 : 0;
  const quality = clamp(
    eventConf * eventCoverage * 0.34 +
    tableConf * 0.20 +
    actorKnown * 0.16 +
    sampleCertainty * 0.22 +
    (Number.isFinite(context.state?.pot) ? 0.08 : 0),
    0,
    1,
  );
  return {
    quality,
    eventCount: events.length,
    actorEventCount: actorEvents.length,
    localChatCount: events.filter((e) => e.source === 'local-dealer-chat').length,
    sampleCertainty,
    actorKnown: Boolean(actor),
  };
}

export function prepareResolverState(context, { budget = 620 } = {}) {
  const t0 = now();
  const fingerprint = resolverFingerprint(context);
  const range = buildOpponentRange({
    hero: context.state?.hero || [],
    board: context.state?.board || [],
    events: context.events || [],
    actorName: context.actorName || null,
    table: context.table || null,
    maxCombos: 280,
  });
  const equity = estimateEquity({
    hero: context.state?.hero || [],
    board: context.state?.board || [],
    range,
    budget,
    seed: fingerprint,
  });
  const evidence = evidenceMetrics(context, equity);
  return {
    fingerprint,
    handId: context.handId,
    street: context.state?.street,
    pot: Number.isFinite(context.state?.pot) ? context.state.pot : null,
    actorName: context.actorName || null,
    table: context.table || null,
    range,
    equity,
    activeOpponents: activeOpponentCount(context.table, context.events || []),
    evidenceQuality: evidence.quality,
    eventCount: evidence.eventCount,
    actorEventCount: evidence.actorEventCount,
    localChatCount: evidence.localChatCount,
    sampleCertainty: evidence.sampleCertainty,
    actorKnown: evidence.actorKnown,
    preparedMs: now() - t0,
    preparedAt: now(),
  };
}

function explanation(best, prepared) {
  const eq = Math.round((prepared.equity?.equity || 0) * 100);
  const strong = Math.round((prepared.range?.summary?.strongShare || 0) * 100);
  if (best.action === 'call') return `PAGAR: equity estimada ~${eq}% contra o range reconstruído; o preço observado mantém o call competitivo.`;
  if (best.action === 'fold') return `DESISTIR: o valor esperado das continuações ficou abaixo do fold; o range reconstruído tem ~${strong}% de região forte neste modelo.`;
  if (best.action === 'raise' || best.action === 'bet' || best.action === 'allin') {
    const fe = Math.round((best.foldEquity || 0) * 100);
    return `${best.action === 'bet' ? 'APOSTAR' : best.action === 'raise' ? 'AUMENTAR' : 'ALL-IN'}: combina ~${eq}% de equity estimada com ~${fe}% de fold equity sustentada pelo contexto observado.`;
  }
  if (best.action === 'check') return `PASSAR: mantém o pote controlado com ~${eq}% de equity estimada sem assumir ação futura que ainda não aconteceu.`;
  return 'Estado local resolvido.';
}

export function decidePrepared(prepared, actions = []) {
  const t0 = now();
  if (!prepared || !Number.isFinite(prepared.pot) || !Number.isFinite(prepared.equity?.equity) || !actions.length) {
    return { decision: 'insufficient', confidence: 0, reason: 'Dados insuficientes para o resolver local.', values: [], ms: now() - t0 };
  }
  const values = estimateActionValues({
    equity: prepared.equity.equity,
    pot: prepared.pot,
    actions,
    rangeSummary: prepared.range?.summary,
    street: prepared.street,
    effectiveStack: prepared.table?.effectiveStack,
    evidenceQuality: prepared.evidenceQuality,
    actorKnown: prepared.actorKnown,
  });
  if (!values.length) return { decision: 'insufficient', confidence: 0, reason: 'Nenhuma ação pôde ser avaliada localmente.', values: [], ms: now() - t0 };

  const best = values[0];
  const scale = Math.max(1, prepared.pot + Math.max(...values.map((v) => Number(v.risk) || 0)));
  const gap = valueGap(values, scale);
  const evidence = prepared.evidenceQuality || 0;
  const sampleCertainty = prepared.sampleCertainty || 0;
  let confidence = Math.round(30 + gap * 32 + evidence * 30 + sampleCertainty * 8);
  if (!prepared.actorKnown) confidence = Math.min(confidence, 55);
  if (!prepared.actorEventCount) confidence = Math.min(confidence, 58);
  if (prepared.activeOpponents > 1) confidence = Math.min(confidence, 68);
  confidence = clamp(confidence, 28, 94);

  const caveats = [];
  if (prepared.activeOpponents > 1) caveats.push('multiway ainda usa aproximação por range principal');
  if (!prepared.actorKnown) caveats.push('rival principal não identificado');
  if (!prepared.actorEventCount) caveats.push('sem ação explícita suficiente do rival');
  if ((prepared.range?.summary?.comboCount || 0) < 80) caveats.push('range estreito por pouca cobertura');

  return {
    decision: best.action,
    confidence,
    reason: explanation(best, prepared),
    values,
    equity: prepared.equity.equity,
    rangeSummary: prepared.range?.summary || null,
    actorName: prepared.actorName,
    eventCount: prepared.eventCount,
    actorEventCount: prepared.actorEventCount,
    localChatCount: prepared.localChatCount,
    evidenceQuality: prepared.evidenceQuality,
    fingerprint: prepared.fingerprint,
    preparedMs: prepared.preparedMs,
    ms: now() - t0,
    caveats,
    engine: 'continual-local-v1',
  };
}

export class ContinualResolver {
  constructor() { this.resetSession(); }
  resetSession() {
    this.generation = 0;
    this.prepared = null;
    this.pendingFingerprint = null;
    this.lastDecision = null;
  }
  resetHand() {
    this.generation++;
    this.prepared = null;
    this.pendingFingerprint = null;
    this.lastDecision = null;
  }
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
    if (!prepared) prepared = prepareResolverState(context, { budget: 180 });
    const decision = decidePrepared(prepared, actions);
    this.lastDecision = decision;
    if (this.prepared?.fingerprint !== fp) this.prepared = prepared;
    return decision;
  }
}

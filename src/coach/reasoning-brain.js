function cardKey(c) { return c ? `${c.rank || '?'}${c.suit ? c.suit[0] : '?'}` : '?'; }
function actionKey(a) { return `${a?.type || '?'}:${Number.isFinite(a?.amount) ? Math.round(a.amount * 100) / 100 : '-'}`; }
function eventKey(e) { return `${e?.street || '?'}:${e?.actorName || '?'}:${e?.action || '?'}:${Number.isFinite(e?.amount) ? Math.round(e.amount * 100) / 100 : '-'}`; }
function seatKey(s) {
  return [
    s?.seatIndex ?? '?',
    s?.actorName || '?',
    Number.isFinite(s?.stack) ? Math.round(s.stack) : '-',
    Number.isFinite(s?.committed) ? Math.round(s.committed) : '-',
    s?.position || '-',
    s?.dealer ? 'D' : '-',
    s?.hero ? 'H' : '-',
    s?.folded === true ? 'F' : s?.folded === false ? 'A' : '?',
  ].join(':');
}

function tableKey(tableState) {
  if (!tableState) return '-';
  return `${tableState.heroPosition || '-'}|${(tableState.seats || []).map(seatKey).join(',')}`;
}

export function reasoningFingerprint({ handId, state, events = [], actorName = null, opponentStats = null, tableState = null } = {}) {
  const hero = (state?.hero || []).map(cardKey).join(',');
  const board = (state?.board || []).map(cardKey).join(',');
  const actions = (state?.actions || []).map(actionKey).sort().join(',');
  const history = events.slice(-16).map(eventKey).join('>');
  const statsKey = opponentStats ? `${opponentStats.hands || 0}:${opponentStats.style || '-'}:${Math.round((opponentStats.bluffPriorAdjustment || 0) * 1000)}` : '-';
  return [handId || 0, state?.street || '-', hero, board, Number.isFinite(state?.pot) ? Math.round(state.pot) : '-', actions, actorName || '-', history, statsKey, tableKey(tableState)].join('|').slice(0, 512);
}

function cleanCard(c) {
  return c ? { rank: c.rank, suit: c.suit || null, confidence: Number.isFinite(c.confidence) ? c.confidence : null } : null;
}

function cleanTable(tableState, actorName) {
  if (!tableState || !Array.isArray(tableState.seats)) return null;
  const seats = tableState.seats.slice(0, 10).map((s) => ({
    seatIndex: Number.isInteger(s.seatIndex) ? s.seatIndex : null,
    actorName: s.actorName || null,
    stack: Number.isFinite(s.stack) ? s.stack : null,
    committed: Number.isFinite(s.committed) ? s.committed : null,
    dealer: Boolean(s.dealer),
    folded: typeof s.folded === 'boolean' ? s.folded : null,
    hero: Boolean(s.hero),
    position: s.position || null,
    confidence: Number.isFinite(s.confidence) ? s.confidence : null,
  }));
  const heroSeat = seats.find((s) => s.hero) || null;
  const villainSeat = actorName ? seats.find((s) => s.actorName && s.actorName.toLowerCase() === actorName.toLowerCase()) || null : null;
  const effectiveStack = heroSeat && villainSeat && Number.isFinite(heroSeat.stack) && Number.isFinite(villainSeat.stack)
    ? Math.min(heroSeat.stack, villainSeat.stack)
    : null;
  return {
    confidence: Number.isFinite(tableState.confidence) ? tableState.confidence : 0,
    dealerSeat: Number.isInteger(tableState.dealerSeat) ? tableState.dealerSeat : null,
    heroSeat: Number.isInteger(tableState.heroSeat) ? tableState.heroSeat : null,
    heroPosition: tableState.heroPosition || null,
    effectiveStack,
    seats,
  };
}

export function buildReasoningPayload({ handId, state, events = [], actorName = null, potBefore = null, opponentStats = null, baseline = null, tableState = null } = {}) {
  const fingerprint = reasoningFingerprint({ handId, state, events, actorName, opponentStats, tableState });
  return {
    mode: 'replay',
    handId,
    fingerprint,
    street: state?.street,
    heroToAct: Boolean(state?.heroToAct),
    hero: (state?.hero || []).map(cleanCard).filter(Boolean),
    board: (state?.board || []).map(cleanCard).filter(Boolean),
    pot: Number.isFinite(state?.pot) ? state.pot : null,
    actions: (state?.actions || []).map((a) => ({ type: a.type, amount: Number.isFinite(a.amount) ? a.amount : null })),
    events: events.slice(-28).map((e) => ({
      street: e.street,
      actorName: e.actorName || null,
      seatLabel: e.seatLabel || null,
      action: e.action,
      amount: Number.isFinite(e.amount) ? e.amount : null,
      confidence: Number.isFinite(e.confidence) ? e.confidence : null,
      source: e.source || null,
    })),
    actorName,
    potBefore: Number.isFinite(potBefore) ? potBefore : null,
    table: cleanTable(tableState, actorName),
    opponentStats: opponentStats || null,
    baseline: baseline ? {
      decision: baseline.decision || null,
      reason: baseline.reason || null,
      confidence: Number.isFinite(baseline.confidence) ? baseline.confidence : null,
      madeHand: baseline.madeHand || null,
      boardProfile: baseline.boardProfile || null,
      blockers: baseline.blockers || null,
      math: baseline.math || null,
      opponent: baseline.opponent || null,
      rangeMix: baseline.rangeMix || null,
    } : null,
  };
}

export function dynamicDecisionIsUsable(result, payload) {
  if (!result || result.handId !== payload?.handId || result.fingerprint !== payload?.fingerprint) return false;
  if (!['fold','check','call','bet','raise','allin','insufficient'].includes(result.decision)) return false;
  if (result.decision === 'insufficient') return true;
  return (payload.actions || []).some((a) => a.type === result.decision);
}

export class ReasoningBrain {
  constructor() {
    this.generation = 0;
    this.controller = null;
    this.busy = false;
    this.last = null;
    this.lastError = null;
    this.activeFingerprint = null;
    this.cache = new Map();
    try { this.accessToken = sessionStorage.getItem('prc.vision-token') || ''; } catch { this.accessToken = ''; }
  }

  setAccessToken(token) {
    const next = String(token || '').trim();
    if (next === this.accessToken) return;
    this.accessToken = next;
    this.resetSession();
  }

  resetSession() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.busy = false;
    this.last = null;
    this.lastError = null;
    this.activeFingerprint = null;
    this.cache.clear();
  }

  resetHand() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.busy = false;
    this.last = null;
    this.lastError = null;
    this.activeFingerprint = null;
  }

  cached(fingerprint) { return this.cache.get(fingerprint) || null; }

  async read(payload) {
    if (!payload?.heroToAct || !payload.fingerprint || payload.hero?.length !== 2 || !payload.actions?.length) return null;
    const cached = this.cached(payload.fingerprint);
    if (cached) { this.last = cached; return cached; }
    if (this.busy && this.activeFingerprint === payload.fingerprint) return null;

    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.busy = true;
    this.activeFingerprint = payload.fingerprint;
    const timeout = setTimeout(() => controller.abort(), 11800);
    try {
      const r = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.accessToken ? { 'x-coach-token': this.accessToken } : {}) },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (generation !== this.generation) return null;
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        this.lastError = j?.error || `HTTP ${r.status}`;
        return null;
      }
      const out = await r.json();
      if (generation !== this.generation || !dynamicDecisionIsUsable(out, payload)) return null;
      this.lastError = null;
      this.last = out;
      this.cache.set(payload.fingerprint, out);
      while (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value);
      return out;
    } catch (e) {
      if (generation !== this.generation) return null;
      if (e?.name !== 'AbortError') this.lastError = 'request-error';
      else this.lastError = 'timeout';
      return null;
    } finally {
      clearTimeout(timeout);
      if (generation === this.generation) {
        this.busy = false;
        if (this.controller === controller) this.controller = null;
      }
    }
  }
}

const clean = (v) => String(v ?? '').trim();
const canon = (v) => clean(v).toLowerCase();

function mapFromInput(input) {
  if (!input) return {};
  if (!Array.isArray(input) && typeof input === 'object') {
    return Object.fromEntries(Object.entries(input).map(([k,v]) => [clean(k), clean(v)]).filter(([,v]) => v));
  }
  if (!Array.isArray(input)) return {};
  const out = {};
  for (const row of input) {
    if (!row || typeof row !== 'object') continue;
    const seatId = clean(row.captureSeatId ?? row.visualSeat ?? row.visualSlot ?? row.slot ?? row.seatId);
    const actor = clean(row.name ?? row.player ?? row.nick ?? row.nickname ?? row.actor);
    if (seatId && actor) out[seatId] = actor;
  }
  return out;
}

export function normalizeCaptureSeatMap(input) {
  return mapFromInput(input);
}

function candidateKey(c) {
  if (c.packetId) return `packet:${c.packetId}`;
  const hand = c.handId ?? 'unknown';
  return [hand, c.street || 'preflop', c.seatId || '?', c.action || '?'].join('|');
}

export function captureEventsToCandidates(events = [], {
  seatMap = {},
  handId = null,
  street = 'preflop',
  heroActor = null,
} = {}) {
  const map = normalizeCaptureSeatMap(seatMap);
  const out = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || e.type !== 'fold-candidate') continue;
    const seatId = clean(e.seatId);
    if (!seatId || seatId === 'hero' || seatId === 'table') continue;
    const actor = clean(map[seatId] || e.actor || '');
    if (actor && heroActor && canon(actor) === canon(heroActor)) continue;
    out.push({
      version: 'capture-action-candidate-v1',
      status: 'provisional',
      sovereign: false,
      source: clean(e.source) || 'action-capture-v1.2',
      handId,
      street: clean(e.street) || street || 'preflop',
      seatId,
      actor: actor || null,
      action: 'FOLD',
      capturedAt: Number(e.at) || Date.now(),
      confidence: Number.isFinite(e.confidence) ? Math.max(0, Math.min(1, e.confidence)) : null,
      packetId: clean(e.packetId) || null,
      evidence: {
        motion: Number.isFinite(e.motion) ? e.motion : null,
        cardMode: clean(e.cardMode) || null,
        cardBefore: Number.isFinite(e.cardTextureBefore) ? e.cardTextureBefore : null,
        cardAfter: Number.isFinite(e.cardTextureAfter) ? e.cardTextureAfter : null,
      },
    });
  }
  return out;
}

export function remapCaptureCandidates(candidates = [], seatMap = {}, heroActor = null) {
  const map = normalizeCaptureSeatMap(seatMap);
  return (Array.isArray(candidates) ? candidates : []).map((c) => {
    if (!c || c.status === 'confirmed') return c;
    const actor = clean(c.actor || map[c.seatId] || '');
    if (actor && heroActor && canon(actor) === canon(heroActor)) {
      return { ...c, actor, status: 'rejected', sovereign: false, rejectReason: 'hero-seat-mismatch' };
    }
    return actor ? { ...c, actor } : c;
  });
}

export function mergeCaptureCandidates(previous = [], incoming = []) {
  const out = [];
  const seen = new Set();
  for (const c of [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!c || typeof c !== 'object') continue;
    const key = candidateKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out.slice(-80);
}

function authoritativeMatch(candidate, ledger) {
  if (!candidate?.actor || !ledger?.actions?.length) return null;
  return ledger.actions.find((a) =>
    a &&
    a.action === candidate.action &&
    canon(a.actor) === canon(candidate.actor) &&
    (!candidate.street || !a.street || a.street === candidate.street)
  ) || null;
}

export function confirmCaptureCandidates(candidates = [], ledger = null) {
  return (Array.isArray(candidates) ? candidates : []).map((c) => {
    if (!c || c.status === 'confirmed' || c.status === 'rejected') return c;
    const match = authoritativeMatch(c, ledger);
    if (!match) return c;
    return {
      ...c,
      status: 'confirmed',
      sovereign: true,
      confirmedBy: 'action-ledger',
      confirmedSeq: match.seq ?? null,
      confirmedRaw: match.raw ?? null,
      confirmedAt: Date.now(),
    };
  });
}

export function captureBridgeSummary(candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [];
  return {
    total: list.length,
    provisional: list.filter((c) => c?.status === 'provisional').length,
    confirmed: list.filter((c) => c?.status === 'confirmed').length,
    rejected: list.filter((c) => c?.status === 'rejected').length,
  };
}

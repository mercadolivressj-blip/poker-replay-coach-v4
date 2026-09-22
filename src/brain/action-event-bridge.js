const clean = (v) => String(v ?? '').trim();
const canon = (v) => clean(v).toLowerCase();
const ACTIONS = new Set(['FOLD','CHECK','CALL','BET','RAISE','ALLIN']);

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

export function normalizeCaptureSeatMap(input) { return mapFromInput(input); }

function candidateKey(c) {
  if (c.packetId) return `packet:${c.packetId}`;
  const hand = c.handId ?? 'unknown';
  const valueKey = c.source === 'local-action-text' ? '' : (c.amount ?? c.totalCommitted ?? '');
  return [hand, c.street || 'preflop', c.seatId || '?', c.actor || '?', c.action || '?', valueKey].join('|');
}

export function captureEventsToCandidates(events = [], {
  seatMap = {}, handId = null, street = 'preflop', heroActor = null,
} = {}) {
  const map = normalizeCaptureSeatMap(seatMap); const out = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || !['fold-candidate','action-candidate'].includes(e.type)) continue;
    const seatId = clean(e.seatId);
    if (!seatId || seatId === 'hero' || seatId === 'table') continue;
    const action = e.type === 'fold-candidate' ? 'FOLD' : clean(e.action).toUpperCase();
    if (!ACTIONS.has(action)) continue;
    const actor = clean(map[seatId] || e.actor || '');
    if (actor && heroActor && canon(actor) === canon(heroActor)) continue;
    const source = clean(e.source) || (e.type === 'fold-candidate' ? 'action-capture-v1.2' : 'local-action-inference');
    const ocrTypeOnly = source === 'local-action-text';
    out.push({
      version: 'capture-action-candidate-v1', status: 'provisional', sovereign: false,
      source,
      handId, street: clean(e.street) || street || 'preflop', seatId, actor: actor || null,
      action,
      // PokerStars plate OCR can see the player's remaining stack next to the action.
      // Therefore OCR is never authoritative for amount. Financial/HH sources own size.
      amount:!ocrTypeOnly && Number.isFinite(e.amount)?e.amount:null,
      totalCommitted:!ocrTypeOnly && Number.isFinite(e.totalCommitted)?e.totalCommitted:null,
      capturedAt: Number(e.capturedAt ?? e.at) || Date.now(),
      confidence: Number.isFinite(e.confidence) ? Math.max(0, Math.min(1, e.confidence)) : null,
      packetId: clean(e.packetId) || null,
      evidence: {
        motion: Number.isFinite(e.motion) ? e.motion : null,
        cardMode: clean(e.cardMode) || null,
        cardBefore: Number.isFinite(e.cardTextureBefore) ? e.cardTextureBefore : null,
        cardAfter: Number.isFinite(e.cardTextureAfter) ? e.cardTextureAfter : null,
        rawText: clean(e.raw ?? e.text) || null,
        ocrObservedAmount:ocrTypeOnly && Number.isFinite(e.amount)?e.amount:null,
        previousCommitted:Number.isFinite(e.previousCommitted)?e.previousCommitted:null,
        maxCommittedBefore:Number.isFinite(e.maxCommittedBefore)?e.maxCommittedBefore:null,
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
    if (actor && heroActor && canon(actor) === canon(heroActor)) return { ...c, actor, status: 'rejected', sovereign: false, rejectReason: 'hero-seat-mismatch' };
    return actor ? { ...c, actor } : c;
  });
}

export function mergeCaptureCandidates(previous = [], incoming = []) {
  const out = []; const seen = new Set();
  for (const c of [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!c || typeof c !== 'object') continue; const key = candidateKey(c);
    if (seen.has(key)) continue; seen.add(key); out.push(c);
  }
  return out.slice(-120);
}

function amountCompatible(candidate, action, epsilon=.005) {
  if(!Number.isFinite(candidate?.amount) || !Number.isFinite(action?.amount)) return true;
  return Math.abs(Number(candidate.amount)-Number(action.amount))<=epsilon;
}

function authoritativeMatch(candidate, ledger, usedIndexes=new Set()) {
  if (!candidate?.actor || !ledger?.actions?.length) return null;
  for(let i=0;i<ledger.actions.length;i++){
    if(usedIndexes.has(i))continue;
    const a=ledger.actions[i];
    if(!a || a.action!==candidate.action)continue;
    if(canon(a.actor)!==canon(candidate.actor))continue;
    if(candidate.street&&a.street&&a.street!==candidate.street)continue;
    if(!amountCompatible(candidate,a))continue;
    return {action:a,index:i};
  }
  return null;
}

export function confirmCaptureCandidates(candidates = [], ledger = null) {
  const usedIndexes=new Set();
  return (Array.isArray(candidates) ? candidates : []).map((c) => {
    if (!c || c.status === 'rejected') return c;
    if(c.status==='confirmed'){
      const idx=(ledger?.actions||[]).findIndex(a=>a?.seq===c.confirmedSeq);
      if(idx>=0)usedIndexes.add(idx);
      return c;
    }
    const found=authoritativeMatch(c,ledger,usedIndexes); if (!found) return c;
    usedIndexes.add(found.index);
    const match=found.action;
    return { ...c, status: 'confirmed', sovereign: true, confirmedBy: 'action-ledger', confirmedSeq: match.seq ?? null, confirmedRaw: match.raw ?? null, confirmedAt: Date.now() };
  });
}

export function captureBridgeSummary(candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [];
  return { total:list.length, provisional:list.filter(c=>c?.status==='provisional').length, confirmed:list.filter(c=>c?.status==='confirmed').length, rejected:list.filter(c=>c?.status==='rejected').length };
}

const INVALID_ACTOR_WORDS = new Set([
  'aumento','aumentar','raise','raised','reraise','re-raise',
  'aposta','apostar','bet','bets','betting',
  'pago','pagar','call','calls','calling',
  'desisto','desistir','fold','folds','folded',
  'passo','passar','check','checks','checked',
  'allin','all-in','all in','max','máx','min','pot','pote',
]);
const AGGRO = new Set(['bet','raise','allin']);
const INVOLVED = new Set(['check','call','bet','raise','allin']);

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function actorKey(value) {
  return normalizeText(value);
}

export function isPlausibleActorName(value) {
  const key = actorKey(value);
  if (!key || key.length < 2) return false;
  if (INVALID_ACTOR_WORDS.has(key)) return false;
  if (/^(seat|lugar)\s*\d+$/i.test(key)) return false;
  if (/^us\$/.test(key)) return false;
  return true;
}

export function canonicalActorName(value, seats = []) {
  if (!isPlausibleActorName(value)) return null;
  const key = actorKey(value);
  const seat = (seats || []).find((item) => item?.actorName && actorKey(item.actorName) === key);
  return seat?.actorName || null;
}

export function fallbackAggressor(seats = [], heroCommitted = null) {
  const heroCommit = Number.isFinite(heroCommitted)
    ? heroCommitted
    : Number((seats || []).find((seat) => seat?.hero)?.committed) || 0;
  const candidates = (seats || [])
    .filter((seat) => !seat?.hero && seat?.folded !== true && isPlausibleActorName(seat?.actorName))
    .filter((seat) => Number.isFinite(seat?.committed) && seat.committed > heroCommit + 0.0005)
    .sort((a, b) => {
      const aAgg = AGGRO.has(a.visibleAction) ? 1 : 0;
      const bAgg = AGGRO.has(b.visibleAction) ? 1 : 0;
      if (aAgg !== bAgg) return bAgg - aAgg;
      return (b.committed || 0) - (a.committed || 0);
    });
  const seat = candidates[0] || null;
  return seat ? {
    actorName: seat.actorName,
    committed: Number.isFinite(seat.committed) ? seat.committed : null,
    confidence: AGGRO.has(seat.visibleAction) ? 0.94 : 0.82,
    source: AGGRO.has(seat.visibleAction) ? 'explicit-table-action' : 'largest-live-commitment',
  } : null;
}

export function resolveAggressorEvidence({ proposedName = null, proposedCommitted = null, heroCommitted = null, seats = [] } = {}) {
  const canonical = canonicalActorName(proposedName, seats);
  if (canonical) {
    const seat = seats.find((item) => actorKey(item?.actorName) === actorKey(canonical));
    return {
      actorName: canonical,
      committed: Number.isFinite(proposedCommitted) ? proposedCommitted : (Number.isFinite(seat?.committed) ? seat.committed : null),
      confidence: 0.96,
      source: 'validated-ai-name',
    };
  }
  return fallbackAggressor(seats, heroCommitted);
}

function eventState(events = [], heroName = null) {
  const hero = actorKey(heroName);
  const states = new Map();
  for (const event of events) {
    const key = actorKey(event?.actorName);
    if (!key || key === hero || !isPlausibleActorName(event?.actorName)) continue;
    const state = states.get(key) || { name: event.actorName, folded: false, involved: false, streets: new Set() };
    state.name = event.actorName || state.name;
    if (event.action === 'fold') state.folded = true;
    else if (INVOLVED.has(event.action)) {
      state.folded = false;
      state.involved = true;
      if (event.street) state.streets.add(event.street);
    }
    states.set(key, state);
  }
  return states;
}

export function engagedOpponentNames({ seats = [], events = [], heroName = null, primaryActor = null, street = 'preflop' } = {}) {
  const hero = actorKey(heroName);
  const seatByKey = new Map((seats || [])
    .filter((seat) => seat?.actorName)
    .map((seat) => [actorKey(seat.actorName), seat]));
  const states = eventState(events, heroName);
  const names = new Map();

  const primary = canonicalActorName(primaryActor, seats);
  if (primary) names.set(actorKey(primary), primary);

  for (const [key, state] of states) {
    const seat = seatByKey.get(key);
    if (seat?.folded === true || state.folded) continue;
    const currentStreetEvidence = state.streets.has(street);
    const priorStreetSurvivor = street !== 'preflop' && state.involved;
    const explicitNow = INVOLVED.has(seat?.visibleAction);
    const chipsNow = street !== 'preflop' && Number.isFinite(seat?.committed) && seat.committed > 0;
    if (currentStreetEvidence || priorStreetSurvivor || explicitNow || chipsNow) names.set(key, seat?.actorName || state.name);
  }

  for (const seat of seats || []) {
    if (seat?.hero || seat?.folded === true || !isPlausibleActorName(seat?.actorName)) continue;
    const key = actorKey(seat.actorName);
    if (hero && key === hero) continue;
    const explicitNow = INVOLVED.has(seat.visibleAction);
    const chipsNow = street !== 'preflop' && Number.isFinite(seat.committed) && seat.committed > 0;
    if (explicitNow || chipsNow) names.set(key, seat.actorName);
  }

  return [...names.values()];
}

const AGGRO = new Set(['bet','raise','allin']);

function key(v) { return String(v || '').trim().toLowerCase(); }
function finite(v) { return Number.isFinite(Number(v)) ? Number(v) : null; }
function pos(seat) { return String(seat?.position || '').toUpperCase(); }
function live(seat) { return seat && seat.folded !== true; }

function tolerance(bb) {
  if (!Number.isFinite(bb) || bb <= 0) return 0.0005;
  return Math.max(0.0005, Math.abs(bb) * 0.08);
}

export function forcedBlindState(seats = []) {
  const liveSeats = (seats || []).filter(live);
  const sbSeat = liveSeats.find((s) => pos(s) === 'SB' || pos(s) === 'BTN/SB') || null;
  const bbSeat = liveSeats.find((s) => pos(s) === 'BB') || null;
  const sb = finite(sbSeat?.committed);
  const bb = finite(bbSeat?.committed);
  return {
    sbSeat,
    bbSeat,
    sb: sb !== null && sb > 0 ? sb : null,
    bb: bb !== null && bb > 0 ? bb : null,
  };
}

export function classifyPreflopContext({
  seats = [],
  heroCommitted = null,
  proposedAggressorName = null,
  proposedAggressorCommitted = null,
} = {}) {
  const liveSeats = (seats || []).filter(live);
  const hero = liveSeats.find((s) => s.hero) || null;
  const blinds = forcedBlindState(liveSeats);
  const bb = blinds.bb;
  const eps = tolerance(bb);

  const explicit = liveSeats
    .filter((s) => !s.hero && AGGRO.has(s.visibleAction))
    .sort((a,b) => (finite(b.committed) || 0) - (finite(a.committed) || 0))[0] || null;

  const aboveBlind = Number.isFinite(bb)
    ? liveSeats
        .filter((s) => !s.hero && finite(s.committed) !== null && finite(s.committed) > bb + eps)
        .sort((a,b) => finite(b.committed) - finite(a.committed))[0] || null
    : null;

  const proposed = liveSeats.find((s) => key(s.actorName) === key(proposedAggressorName)) || null;
  const proposedCommit = finite(proposedAggressorCommitted) ?? finite(proposed?.committed);
  const proposedIsRealRaise = Boolean(proposed && (
    AGGRO.has(proposed.visibleAction)
    || (Number.isFinite(bb) && Number.isFinite(proposedCommit) && proposedCommit > bb + eps)
  ));

  const aggressor = explicit || aboveBlind || (proposedIsRealRaise ? proposed : null);
  if (aggressor) {
    return {
      mode: 'raised',
      heroPosition: pos(hero) || null,
      heroCommitted: finite(heroCommitted) ?? finite(hero?.committed) ?? 0,
      sb: blinds.sb,
      bb,
      sbName: blinds.sbSeat?.actorName || null,
      bbName: blinds.bbSeat?.actorName || null,
      aggressorName: aggressor.actorName || proposedAggressorName || null,
      aggressorCommitted: finite(aggressor.committed) ?? proposedCommit,
      forcedBlindOnly: false,
    };
  }

  const limpers = Number.isFinite(bb)
    ? liveSeats.filter((s) => {
        if (s.hero) return false;
        const p = pos(s);
        if (p === 'SB' || p === 'BTN/SB' || p === 'BB') return false;
        const c = finite(s.committed);
        return c !== null && c >= bb - eps && c <= bb + eps;
      })
    : [];

  if (limpers.length) {
    return {
      mode: 'limped',
      heroPosition: pos(hero) || null,
      heroCommitted: finite(heroCommitted) ?? finite(hero?.committed) ?? 0,
      sb: blinds.sb,
      bb,
      sbName: blinds.sbSeat?.actorName || null,
      bbName: blinds.bbSeat?.actorName || null,
      limperNames: limpers.map((s) => s.actorName).filter(Boolean),
      aggressorName: null,
      aggressorCommitted: null,
      forcedBlindOnly: false,
    };
  }

  return {
    mode: 'unopened',
    heroPosition: pos(hero) || null,
    heroCommitted: finite(heroCommitted) ?? finite(hero?.committed) ?? 0,
    sb: blinds.sb,
    bb,
    sbName: blinds.sbSeat?.actorName || null,
    bbName: blinds.bbSeat?.actorName || null,
    aggressorName: null,
    aggressorCommitted: null,
    forcedBlindOnly: true,
  };
}

export function isForcedBlindOnlyAggressor({ context, actorName, committed } = {}) {
  if (!context || context.mode !== 'unopened') return false;
  const name = key(actorName);
  if (!name) return false;
  const blindName = name === key(context.bbName) || name === key(context.sbName);
  if (!blindName) return false;
  const amount = finite(committed);
  if (!Number.isFinite(context.bb) || amount === null) return true;
  return amount <= context.bb + tolerance(context.bb);
}

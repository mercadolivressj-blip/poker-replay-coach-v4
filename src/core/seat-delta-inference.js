const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;

export function inferSeatAction(prev = {}, cur = {}, { tableMaxBefore = 0, epsilon = 0.02 } = {}) {
  if (prev.cardsPresent === true && cur.cardsPresent === false) return { action:'FOLD', amount:null, source:'card-presence-delta' };

  const pCommit = n(prev.commitment);
  const cCommit = n(cur.commitment);
  const pStack = prev.stack == null ? null : n(prev.stack);
  const cStack = cur.stack == null ? null : n(cur.stack);
  const delta = cCommit - pCommit;

  if (pStack != null && cStack != null && pStack > epsilon && cStack <= epsilon && delta > epsilon) {
    return { action:'ALLIN', amount:cCommit, source:'commitment-plus-stack-delta' };
  }
  if (delta > epsilon) {
    if (cCommit > n(tableMaxBefore) + epsilon) return { action: tableMaxBefore > epsilon ? 'RAISE' : 'BET', amount:cCommit, source:'commitment-delta' };
    return { action:'CALL', amount:cCommit, source:'commitment-delta' };
  }
  if (prev.turn === true && cur.turn === false && Math.abs(delta) <= epsilon) {
    return { action:'CHECK', amount:null, source:'turn-plus-commitment-delta' };
  }
  return null;
}

export function updateSeatObservation(prev = {}, observed = {}) {
  return {
    cardsPresent: observed.cardsPresent ?? prev.cardsPresent ?? null,
    stack: observed.stack ?? prev.stack ?? null,
    previousCommitment: prev.commitment ?? prev.previousCommitment ?? 0,
    commitment: observed.commitment ?? prev.commitment ?? 0,
    turn: observed.turn ?? prev.turn ?? false,
    occupied: observed.occupied ?? prev.occupied ?? false,
  };
}

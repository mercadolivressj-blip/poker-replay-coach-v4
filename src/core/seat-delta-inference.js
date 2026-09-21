const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const finite = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
const money = (v) => Math.round((Number(v)+Number.EPSILON)*100)/100;

export function inferSeatAction(prev = {}, cur = {}, { tableMaxBefore = 0, epsilon = 0.02 } = {}) {
  if (prev.cardsPresent === true && cur.cardsPresent === false) return { action:'FOLD', amount:null, source:'card-presence-delta' };

  const pCommit = n(prev.commitment);
  const cCommit = n(cur.commitment);
  const pStack = prev.stack == null ? null : n(prev.stack);
  const cStack = cur.stack == null ? null : n(cur.stack);
  const delta = cCommit - pCommit;
  const tableMax = n(tableMaxBefore);

  if (pStack != null && cStack != null && pStack > epsilon && cStack <= epsilon && delta > epsilon) {
    return { action:'ALLIN', amount:cCommit, source:'commitment-plus-stack-delta' };
  }
  if (delta > epsilon) {
    if (cCommit > tableMax + epsilon) return { action: tableMax > epsilon ? 'RAISE' : 'BET', amount:cCommit, source:'commitment-delta' };
    return { action:'CALL', amount:cCommit, source:'commitment-delta' };
  }
  if (prev.turn === true && cur.turn === false && Math.abs(delta) <= epsilon) {
    // A player cannot CHECK while still facing a bet. Missing commitment evidence
    // in that situation must stay unresolved so the Snapshot Validator blocks the
    // Brain instead of silently inventing a check.
    if (pCommit + epsilon < tableMax) return null;
    return { action:'CHECK', amount:null, source:'turn-plus-commitment-delta' };
  }
  return null;
}

/** Canonical to-call calculation. Button OCR/time-bank text is never an input. */
export function computeToCallFromCommitments(seatsInput = {}, heroId = 'hero') {
  const rows = Array.isArray(seatsInput)
    ? seatsInput.map((row,i)=>[String(row?.id ?? i),row])
    : Object.entries(seatsInput || {});
  const hero = rows.find(([id])=>id===heroId)?.[1];
  if (!hero || !finite(hero.commitment)) return { value:null, source:'commitment-delta', reason:'hero-commitment-missing' };

  const eligible = rows.filter(([,row]) => row && row.folded !== true && row.cardsPresent !== false && finite(row.commitment));
  if (!eligible.length) return { value:null, source:'commitment-delta', reason:'table-commitments-missing' };
  const heroCommitment=Number(hero.commitment);
  const tableMax=Math.max(...eligible.map(([,row])=>Number(row.commitment)));
  const value=money(Math.max(0,tableMax-heroCommitment));
  return { value, source:'commitment-delta', heroCommitment:money(heroCommitment), tableMax:money(tableMax) };
}

export function updateSeatObservation(prev = {}, observed = {}) {
  return {
    cardsPresent: observed.cardsPresent ?? prev.cardsPresent ?? null,
    stack: observed.stack ?? prev.stack ?? null,
    previousCommitment: prev.commitment ?? prev.previousCommitment ?? 0,
    commitment: observed.commitment ?? prev.commitment ?? 0,
    turn: observed.turn ?? prev.turn ?? false,
    occupied: observed.occupied ?? prev.occupied ?? false,
    folded: observed.folded ?? prev.folded ?? false,
  };
}

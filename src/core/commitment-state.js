const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const money = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

/**
 * Resolve a seat commitment without ever using button OCR/time-bank text.
 * Priority:
 * 1) dedicated numeric ROI read;
 * 2) commitment persisted by the seat-state ledger for the current street;
 * 3) stack delta from the captured street-start stack.
 *
 * The caller must reset persistedCommitment/streetStartStack when the street
 * changes. Ambiguous evidence returns null instead of inventing a value.
 */
export function resolveSeatCommitmentV1({
  ocrValue = null,
  persistedCommitment = null,
  streetStartStack = null,
  currentStack = null,
  epsilon = 0.011,
} = {}) {
  if (finite(ocrValue) && ocrValue >= -epsilon) {
    return { value: money(Math.max(0, ocrValue)), source: 'fixed-roi-numeric' };
  }

  if (finite(persistedCommitment) && persistedCommitment >= -epsilon) {
    return { value: money(Math.max(0, persistedCommitment)), source: 'seat-ledger-persisted' };
  }

  if (finite(streetStartStack) && finite(currentStack)) {
    const delta = Number(streetStartStack) - Number(currentStack);
    if (delta >= -epsilon && delta <= Number(streetStartStack) + epsilon) {
      return {
        value: money(Math.max(0, delta)),
        source: 'street-stack-delta',
      };
    }
  }

  return { value: null, source: null };
}

export function resolveCommitmentMapV1(seats = {}, context = {}) {
  const out = {};
  for (const [seat, row] of Object.entries(seats || {})) {
    const persisted = context.persistedCommitments?.[seat] ?? row?.persistedCommitment ?? null;
    const streetStart = context.streetStartStacks?.[seat] ?? row?.streetStartStack ?? null;
    const currentStack = row?.stack ?? null;
    const ocrValue = row?.commitment ?? null;
    const resolved = resolveSeatCommitmentV1({
      ocrValue,
      persistedCommitment: persisted,
      streetStartStack: streetStart,
      currentStack,
      epsilon: context.epsilon ?? 0.011,
    });
    out[seat] = { ...(row || {}), commitment: resolved.value, commitmentSource: resolved.source };
  }
  return out;
}

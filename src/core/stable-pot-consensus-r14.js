export function normalizePotValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000) / 1000;
}

export function potTolerance(value, ratio = 0.012) {
  const n = Math.abs(Number(value) || 0);
  return Math.max(0.005, n * ratio);
}

export function observeStablePot(consensus, value) {
  const n = normalizePotValue(value);
  if (n === null) return null;

  const closePending = consensus.pending !== null && Math.abs(consensus.pending - n) <= potTolerance(n);
  if (closePending) consensus.hits = (consensus.hits || 0) + 1;
  else {
    consensus.pending = n;
    consensus.hits = 1;
  }

  const current = normalizePotValue(consensus.value);
  if (current === null) {
    if (consensus.hits < 3) return null;
    consensus.value = n;
    return n;
  }

  if (Math.abs(current - n) <= potTolerance(Math.max(current, n))) {
    consensus.value = n;
    consensus.pending = n;
    consensus.hits = Math.max(consensus.hits, 3);
    return n;
  }

  // Pot normally grows within a hand, but OCR can occasionally lock onto the
  // wrong dark pill (for example 4 instead of US$ 0,05). A materially different
  // value must therefore stay stable for several consecutive reads before it is
  // allowed to replace the committed value in either direction.
  const required = n < current ? 4 : 3;
  if (consensus.hits < required) return null;
  consensus.value = n;
  return n;
}

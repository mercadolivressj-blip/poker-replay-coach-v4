const clean = (v) => String(v ?? '').replace(/\r/g,'').replace(/\s+/g,' ').trim();

const STREET = /\*\*\*\s*(HOLE|FLOP|TURN|RIVER)|\bPREFLOP\b|PR[EÉ]-?FLOP/i;
const ACTION = /\b(folds?|checks?|calls?|bets?|raises?|all[ -]?in|shove|desiste|desistiu|passa|passou|paga|pagou|iguala|igualou|aposta|apostou|aumenta|aumentou)\b/i;
const NOISE = /\b(tem \d+ segundos? para agir|tempo extra|time bank|administrador|tournament|começou|started|ganha(?: o)? pote|wins? (?:the )?pot)\b/i;

export function extractPokerActionLines(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  return text.split(/\n+/)
    .map(clean)
    .filter(Boolean)
    .filter((line) => !NOISE.test(line))
    .filter((line) => STREET.test(line) || ACTION.test(line));
}

const norm = (line) => clean(line).toLowerCase();

export function mergeChronologicalHistory(previous = [], incoming = []) {
  const a = Array.isArray(previous) ? previous.map(clean).filter(Boolean) : extractPokerActionLines(previous);
  const b = Array.isArray(incoming) ? incoming.map(clean).filter(Boolean) : extractPokerActionLines(incoming);
  if (!a.length) return b;
  if (!b.length) return a;

  // Cumulative snapshots commonly resend the whole history from the start.
  if (b.length >= a.length && a.every((line, i) => norm(line) === norm(b[i]))) return b;
  if (a.length >= b.length && b.every((line, i) => norm(line) === norm(a[i]))) return a;

  // Otherwise append only the non-overlapping suffix.
  let overlap = 0;
  const max = Math.min(a.length, b.length);
  for (let n = max; n >= 1; n -= 1) {
    let same = true;
    for (let i = 0; i < n; i += 1) {
      if (norm(a[a.length - n + i]) !== norm(b[i])) { same = false; break; }
    }
    if (same) { overlap = n; break; }
  }
  return [...a, ...b.slice(overlap)];
}

export function combineActionSources({ visionHistory = [], handHistoryText = '', manualHistory = [] } = {}) {
  let out = [];
  out = mergeChronologicalHistory(out, visionHistory);
  out = mergeChronologicalHistory(out, extractPokerActionLines(handHistoryText));
  out = mergeChronologicalHistory(out, manualHistory);
  return out.slice(-120);
}

const ACTION_PATTERNS = Object.freeze([
  ['allin', /\b(all\s*[- ]?in|tudo|vai\s+all\s*[- ]?in)\b/i],
  ['fold', /\b(desist(?:e|iu)?|fold(?:s|ed)?)\b/i],
  ['check', /\b(passa|passou|check(?:s|ed)?)\b/i],
  ['raise', /\b(aumenta|aumentou|raise(?:s|d)?)\b/i],
  ['bet', /\b(aposta|apostou|bet(?:s|ted)?)\b/i],
  ['call', /\b(paga|pagou|iguala|igualou|call(?:s|ed)?)\b/i],
]);

const SIX_MAX = Object.freeze([
  { x: 0.33, y: 0.88, w: 0.35, h: 0.31 },
  { x: 0.80, y: 0.52, w: 0.34, h: 0.28 },
  { x: 0.78, y: -0.11, w: 0.35, h: 0.30 },
  { x: 0.32, y: -0.27, w: 0.38, h: 0.32 },
  { x: -0.13, y: -0.11, w: 0.35, h: 0.30 },
  { x: -0.18, y: 0.52, w: 0.36, h: 0.28 },
]);

// Full-ring PokerStars geometry measured from replay frames relative to the
// detected felt, not to the browser window. Seat 0 is always Hero/bottom-centre.
const NINE_MAX = Object.freeze([
  { x: 0.32, y: 0.96, w: 0.32, h: 0.22 },
  { x: 0.79, y: 0.78, w: 0.31, h: 0.22 },
  { x: 0.91, y: 0.36, w: 0.33, h: 0.22 },
  { x: 0.90, y: -0.07, w: 0.32, h: 0.22 },
  { x: 0.59, y: -0.28, w: 0.31, h: 0.22 },
  { x: 0.08, y: -0.28, w: 0.34, h: 0.22 },
  { x: -0.19, y: -0.07, w: 0.33, h: 0.22 },
  { x: -0.25, y: 0.35, w: 0.34, h: 0.22 },
  { x: -0.11, y: 0.78, w: 0.32, h: 0.22 },
]);

function clamp01(n) { return Math.max(0, Math.min(1, n)); }
function normalize(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function inferPokerStarsTableSize(text) {
  const n = normalize(text);
  if (/\b6\s*[- ]?max\b/.test(n)) return 6;
  if (/\b9\s*[- ]?max\b|\bfull\s*ring\b/.test(n)) return 9;
  return null;
}

export function parsePokerStarsNumber(raw) {
  let s = String(raw || '').replace(/[^0-9.,]/g, '').replace(/^[.,]+|[.,]+$/g, '');
  if (!s || !/\d/.test(s)) return null;
  const groups = s.split(/[.,]/);
  if (groups.length > 1 && groups.slice(1).every((g) => /^\d{3}$/.test(g))) {
    const n = Number(groups.join(''));
    return Number.isFinite(n) ? n : null;
  }
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (lastSep > 0) {
    const tail = s.slice(lastSep + 1);
    if (/^\d{1,2}$/.test(tail)) {
      const whole = s.slice(0, lastSep).replace(/[.,]/g, '');
      const n = Number(`${whole}.${tail}`);
      return Number.isFinite(n) ? n : null;
    }
  }
  const n = Number(s.replace(/[.,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function actionFromLine(line) {
  const n = normalize(line);
  for (const [action, re] of ACTION_PATTERNS) if (re.test(n)) return action;
  return null;
}

function amountFromLine(line) {
  const all = [...String(line || '').matchAll(/([0-9][0-9.,]*)/g)];
  return all.length ? parsePokerStarsNumber(all.at(-1)[1]) : null;
}

function nameCandidate(line) {
  const s = String(line || '').trim();
  if (!s || s.length > 28) return null;
  const n = normalize(s);
  if (!/[a-z0-9]/i.test(s)) return null;
  if (/lugar\s+vazio|empty\s+seat|seat\s+open|ausente|sitting\s+out/.test(n)) return null;
  if (/venceu|ganhou|winner|pote|pot|dealer|sequencia|straight|flush|trinca|par|dois pares|two pair|full house/.test(n)) return null;
  if (actionFromLine(s)) return null;
  if (/^(us\$|r\$|\$)?\s*[0-9][0-9.,]*$/i.test(s)) return null;
  const cleaned = s.replace(/^[^A-Za-z0-9_]+|[^A-Za-z0-9_.-]+$/g, '').trim();
  if (cleaned.length < 3) return null;
  // PokerStars nicknames in these replay layouts are rendered as a single token.
  // Reject whitespace-heavy OCR hallucinations such as "fA Ua".
  if (/\s/.test(cleaned)) return null;
  return cleaned;
}

export function parseSeatText(text) {
  const raw = String(text || '').trim();
  const normalized = normalize(raw);
  if (!raw) return { occupied: false, empty: false, away: false, actorName: null, stack: null, visibleAction: null, visibleActionAmount: null, raw: '' };
  if (/lugar\s+vazio|empty\s+seat|seat\s+open/.test(normalized)) {
    return { occupied: false, empty: true, away: false, actorName: null, stack: null, visibleAction: null, visibleActionAmount: null, raw };
  }
  const away = /\bausente\b|\bsitting\s+out\b/.test(normalized);
  const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let visibleAction = null;
  let visibleActionAmount = null;
  for (const line of lines) {
    const action = actionFromLine(line);
    if (!action) continue;
    visibleAction = action;
    visibleActionAmount = ['fold', 'check'].includes(action) ? null : amountFromLine(line);
    break;
  }
  let stack = null;
  for (const line of lines) {
    if (actionFromLine(line)) continue;
    const compact = line.replace(/\s/g, '');
    if (!/^(?:US\$|R\$|\$)?[0-9][0-9.,]*$/i.test(compact)) continue;
    const value = parsePokerStarsNumber(compact);
    if (Number.isFinite(value)) stack = value;
  }
  const actorName = lines.map(nameCandidate).find(Boolean) || null;
  const occupied = Boolean(actorName || Number.isFinite(stack) || visibleAction || away);
  return { occupied, empty: false, away, actorName, stack, visibleAction, visibleActionAmount, raw };
}

export function seatRectsFromFelt(felt, tableSize = 6) {
  if (!felt) return [];
  const layout = tableSize === 9 ? NINE_MAX : SIX_MAX;
  return layout.map((r, seatIndex) => {
    const x = clamp01(felt.x + r.x * felt.w);
    const y = clamp01(felt.y + r.y * felt.h);
    const right = clamp01(felt.x + (r.x + r.w) * felt.w);
    const bottom = clamp01(felt.y + (r.y + r.h) * felt.h);
    return { seatIndex, x, y, w: Math.max(0.02, right - x), h: Math.max(0.02, bottom - y) };
  });
}

export function seatLayoutCandidates(felt) {
  return { 6: seatRectsFromFelt(felt, 6), 9: seatRectsFromFelt(felt, 9) };
}

export function inferActionFromStacks({ previousStack, currentStack, previousCommitted = 0, maxCommitted = 0, epsilon = 0.75 } = {}) {
  if (!Number.isFinite(previousStack) || !Number.isFinite(currentStack)) return null;
  const delta = previousStack - currentStack;
  if (!(delta > epsilon)) return null;
  const committed = Math.max(0, Number(previousCommitted) || 0) + delta;
  let action = null;
  if (currentStack <= epsilon) action = 'allin';
  else if (maxCommitted <= epsilon) action = 'bet';
  else if (committed > maxCommitted + epsilon) action = 'raise';
  else if (Math.abs(committed - maxCommitted) <= Math.max(epsilon, maxCommitted * 0.025)) action = 'call';
  return { action, amount: delta, committed, delta };
}

export function stableNumericObservation(memory, value, { tolerance = 0.018, hits = 2 } = {}) {
  if (!Number.isFinite(value)) return { accepted: false, value: memory?.value ?? null, memory: memory || { value: null, pending: null, hits: 0 } };
  const m = memory ? { ...memory } : { value: null, pending: null, hits: 0 };
  if (Number.isFinite(m.value) && Math.abs(value - m.value) <= Math.max(0.6, Math.abs(m.value) * tolerance)) {
    m.pending = null; m.hits = 0;
    return { accepted: false, value: m.value, memory: m };
  }
  if (Number.isFinite(m.pending) && Math.abs(value - m.pending) <= Math.max(0.6, Math.abs(m.pending) * tolerance)) m.hits++;
  else { m.pending = value; m.hits = 1; }
  if (m.hits >= hits) {
    m.value = m.pending; m.pending = null; m.hits = 0;
    return { accepted: true, value: m.value, memory: m };
  }
  return { accepted: false, value: m.value, memory: m };
}

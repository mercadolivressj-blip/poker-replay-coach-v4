import { parseNumberText } from './ocr.js';

const CLEAN_SPACE = /\s+/g;

function cleanActor(s) {
  return String(s || '').replace(/^dealer\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
}

function numberFrom(s) {
  const n = parseNumberText(String(s || ''));
  return Number.isFinite(n) ? n : null;
}

const ACTION_PATTERNS = [
  { action: 'fold', re: /^(.+?)\s*:\s*(?:desiste|folds?|foldou)\b/i },
  { action: 'check', re: /^(.+?)\s*:\s*(?:passa|checks?|checkou)\b/i },
  { action: 'call', re: /^(.+?)\s*:\s*(?:paga|calls?|pagou)\s*([\d.,]+)?/i },
  { action: 'bet', re: /^(.+?)\s*:\s*(?:aposta|bets?|apostou)\s*([\d.,]+)?/i },
  { action: 'raise', re: /^(.+?)\s*:\s*(?:aumenta|raises?|aumentou)(?:\s+[\d.,]+)?(?:\s+(?:para|to))?\s*([\d.,]+)?/i },
  { action: 'allin', re: /^(.+?)\s*:\s*(?:(?:est[aá]\s+)?all[- ]?in|vai\s+all[- ]?in)(?:\s+por|\s+for)?\s*([\d.,]+)?/i },
];

export function parseActionLogLine(text, { handId, street, observedAt = null } = {}) {
  const line = String(text || '').replace(CLEAN_SPACE, ' ').trim();
  if (!line || !Number.isInteger(handId) || !street) return null;
  for (const p of ACTION_PATTERNS) {
    const m = line.match(p.re);
    if (!m) continue;
    const actorName = cleanActor(m[1]);
    if (!actorName) return null;
    return {
      handId,
      street,
      actorName,
      seatLabel: null,
      action: p.action,
      amount: numberFrom(m[2]),
      source: 'action-log-ocr',
      confidence: 0.78,
      observedAt,
      raw: line,
    };
  }
  return null;
}

export function parseActionLogText(text, meta = {}) {
  const seen = new Set();
  const out = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const event = parseActionLogLine(rawLine, meta);
    if (!event) continue;
    const key = `${event.actorName}|${event.action}|${event.amount ?? '-'}|${event.street}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

const ACTION_WORDS = /\b(desiste|folds?|passa|checks?|paga|calls?|iguala|aposta|bets?|aumenta|raises?|all[- ]?in)\b/i;

function normalize(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function parseAmount(text) {
  const s0 = String(text || '');
  const finalTarget = s0.match(/(?:para|to)\s*([0-9][0-9.,]*)/i);
  const any = [...s0.matchAll(/([0-9][0-9.,]*)/g)];
  const raw = finalTarget?.[1] || any.at(-1)?.[1] || null;
  if (!raw) return null;
  let s = raw.replace(/\s/g, '');
  const groups = s.split(/[.,]/);
  if (groups.length > 1 && groups.slice(1).every((g) => /^\d{3}$/.test(g))) s = groups.join('');
  else s = s.replace(',', '.');
  const n = Number(s.replace(/\.(?=.*\.)/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function parseDealerActionLine(line) {
  const raw = String(line || '').trim();
  const m = raw.match(/^([^:]{1,40}):\s*(.+)$/);
  if (!m) return null;
  const actorName = m[1].trim();
  const text = m[2].trim();
  const n = normalize(text);
  if (!actorName || /^(dealer|sistema|system)$/i.test(actorName) || !ACTION_WORDS.test(n)) return null;

  let action = null;
  if (/\b(desiste|folds?)\b/.test(n)) action = 'fold';
  else if (/\b(passa|checks?)\b/.test(n)) action = 'check';
  else if (/\ball[- ]?in\b/.test(n)) action = 'allin';
  else if (/\b(aumenta|raises?)\b/.test(n)) action = 'raise';
  else if (/\b(aposta|bets?)\b/.test(n)) action = 'bet';
  else if (/\b(paga|calls?|iguala)\b/.test(n)) action = 'call';
  if (!action) return null;

  const amount = ['fold','check'].includes(action) ? null : parseAmount(text);
  return { actorName, action, amount };
}

export { parseAmount };

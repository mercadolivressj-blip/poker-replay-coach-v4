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

function splitActorAndAction(rawLine) {
  let body = String(rawLine || '').trim();
  if (!body) return null;

  // PokerStars system chat commonly prefixes explicit actions with "Dealer:".
  // Strip only the system prefix; the remaining text must still contain an explicit action verb.
  body = body.replace(/^(?:Dealer|Sistema|System)\s*:\s*/i, '').trim();
  if (!body) return null;

  const colon = body.match(/^([^:]{1,40})\s*:\s*(.+)$/);
  if (colon) {
    const actorName = colon[1].trim();
    const text = colon[2].trim();
    return actorName && ACTION_WORDS.test(normalize(text)) ? { actorName, text } : null;
  }

  const actionMatch = ACTION_WORDS.exec(body);
  if (!actionMatch || actionMatch.index <= 0) return null;
  const actorName = body.slice(0, actionMatch.index).replace(/[\s,:;\-–—]+$/g, '').trim();
  const text = body.slice(actionMatch.index).trim();
  if (!actorName || actorName.length > 40) return null;
  return { actorName, text };
}

export function parseDealerActionLine(line) {
  const parts = splitActorAndAction(line);
  if (!parts) return null;
  const { actorName, text } = parts;
  const n = normalize(text);
  if (!ACTION_WORDS.test(n)) return null;

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

export { parseAmount, splitActorAndAction };

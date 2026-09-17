const STREET_ORDER = ['preflop','flop','turn','river'];

export function streetFromBoard(board = []) {
  const n = Array.isArray(board) ? board.length : 0;
  return n >= 5 ? 'river' : n === 4 ? 'turn' : n >= 3 ? 'flop' : 'preflop';
}

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const canonActor = (v) => clean(v).replace(/^dealer\s*:\s*/i, '').replace(/^[\-*]+|[\-*]+$/g, '').trim();

function markerStreet(line) {
  const s = line.toUpperCase();
  if (/\*\*\*\s*FLOP|\bFLOP\b/.test(s)) return 'flop';
  if (/\*\*\*\s*TURN|\bTURN\b/.test(s)) return 'turn';
  if (/\*\*\*\s*RIVER|\bRIVER\b/.test(s)) return 'river';
  if (/\*\*\*\s*HOLE|\bPREFLOP\b|PR[EÉ]-?FLOP/.test(s)) return 'preflop';
  return null;
}

function actionType(line) {
  const s = line.toUpperCase();
  if (/\bALL[ -]?IN\b|\bSHOVE\b/.test(s)) return 'ALLIN';
  if (/\bFOLDS?\b|\bDESIST(?:E|IU|IR)\b/.test(s)) return 'FOLD';
  if (/\bCHECKS?\b|\bPASSA(?:R|OU)?\b/.test(s)) return 'CHECK';
  if (/\bRAISES?\b|\bAUMENTA(?:R|OU)?\b|\b3-?BET\b/.test(s)) return 'RAISE';
  if (/\bBETS?\b|\bAPOSTA(?:R|OU)?\b/.test(s)) return 'BET';
  if (/\bCALLS?\b|\bPAGA(?:R|OU)?\b|\bIGUALA(?:R|OU)?\b/.test(s)) return 'CALL';
  return null;
}

function noise(line) {
  return /\bÉ A SUA VEZ\b|\bE A SUA VEZ\b|\bTEM \d+ SEGUNDOS? PARA AGIR\b|TEMPO EXTRA|TIME BANK|GANHA(?: O)? POTE|WINS? (?:THE )?POT|ADMINISTRADOR|TOURNAMENT|COMEÇOU|STARTED/.test(line.toUpperCase());
}

function actorFromLine(line, action) {
  const colon = line.match(/^([^:]{1,40}):\s*/);
  if (colon) return canonActor(colon[1]);
  const beforeAction = line.match(new RegExp(`^(.{1,40}?)\\s+(?:${action === 'FOLD' ? 'folds?|desiste|desistiu' : action === 'CHECK' ? 'checks?|passa|passou' : action === 'CALL' ? 'calls?|paga|pagou|iguala|igualou' : action === 'BET' ? 'bets?|aposta|apostou' : action === 'RAISE' ? 'raises?|aumenta|aumentou|3-?bet' : 'all[ -]?in|shove'})\\b`, 'i'));
  if (beforeAction) return canonActor(beforeAction[1]);
  const pos = line.match(/^\s*(UTG|HJ|CO|BTN|BU|SB|BB|HERO)\b/i);
  return pos ? pos[1].toUpperCase().replace('BU','BTN') : null;
}

function moneyTokens(line) {
  const matches = [...line.matchAll(/(?:US\$|R\$|\$|€|£)?\s*(\d+(?:[.,]\d+)?)/gi)]
    .map((m) => Number(String(m[1]).replace(',','.')))
    .filter(Number.isFinite);
  return matches;
}

export function parseActionLine(raw, fallbackStreet = 'preflop') {
  const line = clean(raw);
  if (!line || noise(line)) return null;
  const marker = markerStreet(line);
  if (marker) return { kind:'street', street:marker, raw:line };
  const action = actionType(line);
  if (!action) return null;
  const actor = actorFromLine(line, action);
  if (!actor) return null;
  const nums = moneyTokens(line);
  const toMatch = line.match(/\bto\s+(?:US\$|R\$|\$|€|£)?\s*(\d+(?:[.,]\d+)?)/i);
  const toAmount = toMatch ? Number(toMatch[1].replace(',','.')) : null;
  const amount = nums.length ? nums[0] : null;
  return {
    kind:'action',
    street: fallbackStreet,
    actor,
    action,
    amount,
    toAmount: Number.isFinite(toAmount) ? toAmount : null,
    allIn: action === 'ALLIN' || /all[ -]?in|shove/i.test(line),
    raw: line,
  };
}

export function createLedger({ handId = null, heroActor = null, seats = [] } = {}) {
  return {
    version:'action-ledger-v1-external',
    handId,
    heroActor: heroActor ? canonActor(heroActor) : null,
    seats: Array.isArray(seats) ? seats : [],
    actions:[],
    seen:[],
    street:'preflop',
    preflopAggressor:null,
    lastAggressor:null,
    playersSeen:[],
  };
}

function actionKey(a) {
  return [a.street,a.actor,a.action,a.amount ?? '',a.toAmount ?? '',a.raw.toLowerCase()].join('|');
}

function rebuildDerived(ledger) {
  let pfa = null, last = null;
  const players = new Set();
  for (const a of ledger.actions) {
    players.add(a.actor);
    if (a.action === 'BET' || a.action === 'RAISE' || a.action === 'ALLIN') {
      last = a.actor;
      if (a.street === 'preflop') pfa = a.actor;
    }
  }
  ledger.preflopAggressor = pfa;
  ledger.lastAggressor = last;
  ledger.playersSeen = [...players];
  return ledger;
}

export function applyActionHistory(ledgerInput, history = [], board = []) {
  const ledger = ledgerInput ? {
    ...ledgerInput,
    actions:[...(ledgerInput.actions || [])],
    seen:[...(ledgerInput.seen || [])],
    playersSeen:[...(ledgerInput.playersSeen || [])],
  } : createLedger();
  const seen = new Set(ledger.seen);
  let street = ledger.street || streetFromBoard(board);
  for (const raw of Array.isArray(history) ? history : []) {
    const parsed = parseActionLine(raw, street);
    if (!parsed) continue;
    if (parsed.kind === 'street') { street = parsed.street; continue; }
    parsed.street = street;
    const key = actionKey(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    ledger.actions.push({ ...parsed, seq:ledger.actions.length + 1 });
  }
  ledger.seen = [...seen];
  ledger.street = STREET_ORDER.indexOf(street) >= 0 ? street : streetFromBoard(board);
  return rebuildDerived(ledger);
}

export function buildLedgerFromState(state = {}, { handId = null, heroActor = null } = {}) {
  const seats = Array.isArray(state.seats) ? state.seats : [];
  let hero = heroActor;
  if (!hero) {
    const s = seats.find((x) => x && x.isHero);
    hero = s?.name || s?.player || s?.nick || s?.nickname || null;
  }
  const ledger = createLedger({ handId, heroActor:hero, seats });
  ledger.street = streetFromBoard(state.board);
  return applyActionHistory(ledger, state.actionHistory, state.board);
}

export function ledgerSummary(ledger) {
  const byStreet = { preflop:[], flop:[], turn:[], river:[] };
  for (const a of ledger?.actions || []) (byStreet[a.street] || byStreet.preflop).push(a);
  return {
    version: ledger?.version || 'action-ledger-v1-external',
    handId: ledger?.handId ?? null,
    street: ledger?.street || 'preflop',
    actionCount: ledger?.actions?.length || 0,
    preflopAggressor: ledger?.preflopAggressor || null,
    lastAggressor: ledger?.lastAggressor || null,
    playersSeen: ledger?.playersSeen || [],
    byStreet,
  };
}

export function heroWasPreflopAggressor(ledger) {
  if (!ledger?.heroActor || !ledger?.preflopAggressor) return null;
  return canonActor(ledger.heroActor).toLowerCase() === canonActor(ledger.preflopAggressor).toLowerCase();
}

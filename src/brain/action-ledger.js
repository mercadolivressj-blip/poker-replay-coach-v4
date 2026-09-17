const STREET_ORDER = ['preflop','flop','turn','river'];

export function streetFromBoard(board = []) {
  const n = Array.isArray(board) ? board.length : 0;
  return n >= 5 ? 'river' : n === 4 ? 'turn' : n >= 3 ? 'flop' : 'preflop';
}

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const canonActor = (v) => clean(v).replace(/^dealer\s*:\s*/i, '').replace(/^[\-*]+|[\-*]+$/g, '').trim();

const ACTION_VERBS = [
  { action:'FOLD', re:/\b(?:folds?|desiste|desistiu|desistir)\b/i },
  { action:'CHECK', re:/\b(?:checks?|passa|passou|passar)\b/i },
  { action:'RAISE', re:/\b(?:raises?|aumenta|aumentou|aumentar|3-?bet)\b/i },
  { action:'BET', re:/\b(?:bets?|aposta|apostou|apostar)\b/i },
  { action:'CALL', re:/\b(?:calls?|paga|pagou|pagar|iguala|igualou|igualar)\b/i },
  { action:'ALLIN', re:/\b(?:all[ -]?in|shove)\b/i },
];

function earliestActionVerb(line) {
  let best=null;
  for (const row of ACTION_VERBS) {
    const m=row.re.exec(line);
    if(!m)continue;
    if(!best || m.index<best.index) best={...row,index:m.index,end:m.index+m[0].length,text:m[0]};
  }
  return best;
}

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
  // Preserve ALL-IN as an explicit semantic action when the line says it, while
  // actor/amount extraction still anchors on the earliest actual action verb.
  if (/\bALL[ -]?IN\b|\bSHOVE\b/.test(s)) return 'ALLIN';
  const verb=earliestActionVerb(line);
  return verb?.action || null;
}

function noise(line) {
  return /\bÉ A SUA VEZ\b|\bE A SUA VEZ\b|\bTEM \d+ SEGUNDOS? PARA AGIR\b|TEMPO EXTRA|TIME BANK|GANHA(?: O)? POTE|WINS? (?:THE )?POT|ADMINISTRADOR|TOURNAMENT|COMEÇOU|STARTED/.test(line.toUpperCase());
}

function actorFromLine(line) {
  const colon = line.match(/^([^:]{1,40}):\s*/);
  if (colon) return canonActor(colon[1]);
  const verb=earliestActionVerb(line);
  if(verb?.index>0){
    const actor=canonActor(line.slice(0,verb.index));
    if(actor)return actor;
  }
  const pos = line.match(/^\s*(UTG|HJ|CO|BTN|BU|SB|BB|HERO)\b/i);
  return pos ? pos[1].toUpperCase().replace('BU','BTN') : null;
}

function moneyTokens(text) {
  return [...String(text||'').matchAll(/(?:US\$|R\$|\$|€|£)?\s*(\d+(?:[.,]\d+)?)/gi)]
    .map((m) => Number(String(m[1]).replace(',','.')))
    .filter(Number.isFinite);
}

export function parseActionLine(raw, fallbackStreet = 'preflop') {
  const line = clean(raw);
  if (!line || noise(line)) return null;
  const marker = markerStreet(line);
  if (marker) return { kind:'street', street:marker, raw:line };
  const action = actionType(line);
  if (!action) return null;
  const actor = actorFromLine(line);
  if (!actor) return null;

  // Critical rule: never scan money from the actor/nickname prefix. PokerStars names
  // commonly contain digits (e.g. NicholasCason7, Player2); those are not sizing.
  const verb=earliestActionVerb(line);
  const suffix=verb ? line.slice(verb.end) : '';
  const nums = moneyTokens(suffix);
  const toMatch = suffix.match(/\b(?:to|para)\s+(?:US\$|R\$|\$|€|£)?\s*(\d+(?:[.,]\d+)?)/i);
  const toAmount = toMatch ? Number(toMatch[1].replace(',','.')) : null;
  const amount = nums.length ? nums[0] : null;
  return {
    kind:'action', street:fallbackStreet, actor, action, amount,
    toAmount:Number.isFinite(toAmount) ? toAmount : null,
    allIn:action === 'ALLIN' || /all[ -]?in|shove/i.test(line), raw:line,
  };
}

export function createLedger({ handId = null, heroActor = null, seats = [] } = {}) {
  return {
    version:'action-ledger-v1-external', handId,
    heroActor:heroActor ? canonActor(heroActor) : null,
    seats:Array.isArray(seats) ? seats : [], actions:[], seen:[], street:'preflop',
    preflopAggressor:null, lastAggressor:null, playersSeen:[],
  };
}

function actionKey(a) { return [a.street,a.actor,a.action,a.amount ?? '',a.toAmount ?? '',a.raw.toLowerCase()].join('|'); }

function rebuildDerived(ledger) {
  let pfa=null,last=null; const players=new Set();
  for (const a of ledger.actions) {
    players.add(a.actor);
    if (['BET','RAISE','ALLIN'].includes(a.action)) { last=a.actor; if (a.street==='preflop') pfa=a.actor; }
  }
  ledger.preflopAggressor=pfa; ledger.lastAggressor=last; ledger.playersSeen=[...players];
  return ledger;
}

export function applyActionHistory(ledgerInput, history = [], board = []) {
  const ledger=ledgerInput ? {...ledgerInput,actions:[...(ledgerInput.actions||[])],seen:[...(ledgerInput.seen||[])],playersSeen:[...(ledgerInput.playersSeen||[])]} : createLedger();
  const seen=new Set(ledger.seen); let street=ledger.street || 'preflop';
  for (const raw of Array.isArray(history) ? history : []) {
    const parsed=parseActionLine(raw,street); if(!parsed) continue;
    if(parsed.kind==='street'){street=parsed.street;continue;}
    parsed.street=street; const key=actionKey(parsed); if(seen.has(key))continue;
    seen.add(key); ledger.actions.push({...parsed,seq:ledger.actions.length+1});
  }
  ledger.seen=[...seen]; ledger.street=STREET_ORDER.indexOf(street)>=0?street:streetFromBoard(board);
  return rebuildDerived(ledger);
}

export function buildLedgerFromState(state = {}, { handId = null, heroActor = null } = {}) {
  const seats=Array.isArray(state.seats)?state.seats:[]; let hero=heroActor;
  if(!hero){const s=seats.find((x)=>x&&x.isHero);hero=s?.name||s?.player||s?.nick||s?.nickname||null;}
  const ledger=createLedger({handId,heroActor:hero,seats});
  ledger.street='preflop';
  const out=applyActionHistory(ledger,state.actionHistory,state.board);
  out.street=streetFromBoard(state.board);
  return out;
}

export function ledgerSummary(ledger) {
  const byStreet={preflop:[],flop:[],turn:[],river:[]};
  for(const a of ledger?.actions||[])(byStreet[a.street]||byStreet.preflop).push(a);
  return {version:ledger?.version||'action-ledger-v1-external',handId:ledger?.handId??null,street:ledger?.street||'preflop',actionCount:ledger?.actions?.length||0,preflopAggressor:ledger?.preflopAggressor||null,lastAggressor:ledger?.lastAggressor||null,playersSeen:ledger?.playersSeen||[],byStreet};
}

export function heroWasPreflopAggressor(ledger) {
  if(!ledger?.heroActor||!ledger?.preflopAggressor)return null;
  return canonActor(ledger.heroActor).toLowerCase()===canonActor(ledger.preflopAggressor).toLowerCase();
}

const POSITION_ALIASES={EP:'UTG',MP:'HJ',LJ:'HJ',BU:'BTN',BUTTON:'BTN',UTG:'UTG',HJ:'HJ',CO:'CO',BTN:'BTN',SB:'SB',BB:'BB'};
const POSITIONS_BY_N={
  6:['BTN','SB','BB','UTG','HJ','CO'],
  5:['BTN','SB','BB','UTG','CO'],
  4:['BTN','SB','BB','CO'],
  3:['BTN','SB','BB'],
  2:['SB','BB'],
};

const clean=(v)=>String(v??'').trim();
export const normalizeReplayPosition=(v)=>POSITION_ALIASES[clean(v).toUpperCase()]||null;

const numberText=(v)=>{
  if(v==null)return null;
  const hits=String(v).match(/\d+(?:[.,]\d+)?/g);
  if(!hits?.length)return null;
  const n=Number(hits[hits.length-1].replace(',','.'));
  return Number.isFinite(n)?n:null;
};

const blindsFromText=(v)=>{
  const hits=String(v??'').match(/\d+(?:[.,]\d+)?/g)||[];
  if(hits.length<2)return null;
  const sb=Number(hits[hits.length-2].replace(',','.')),bb=Number(hits[hits.length-1].replace(',','.'));
  return Number.isFinite(sb)&&Number.isFinite(bb)&&bb>0?{sb,bb}:null;
};

function orderedSeats(seats){
  const rows=(Array.isArray(seats)?seats:[]).filter(Boolean);
  if(rows.length<2)return rows;
  const withNumbers=rows.every(r=>Number.isFinite(Number(r?.seat)));
  return withNumbers?[...rows].sort((a,b)=>Number(a.seat)-Number(b.seat)):rows;
}

/**
 * Replay metadata marks folded players as isActive=false. They must stay in the
 * seating ring: filtering them out remaps the dealer/button and corrupts Hero's
 * position mid-hand. Prefer the explicit Hero position when Vision already read it;
 * otherwise derive from the full seated ring, including folded players.
 */
export function deriveReplayHeroPosition(seats){
  const rows=orderedSeats(seats);
  const hero=rows.find(r=>r?.isHero===true);
  const explicit=normalizeReplayPosition(hero?.position);
  if(explicit)return explicit;
  if(rows.length<2)return null;
  const d=rows.findIndex(r=>r?.isDealer===true),h=rows.findIndex(r=>r?.isHero===true);
  if(d<0||h<0)return null;
  const positions=POSITIONS_BY_N[rows.length];
  if(!positions)return null;
  return positions[(h-d+rows.length)%rows.length]||null;
}

const historyText=(row)=>typeof row==='string'?row:JSON.stringify(row??'');
const strategicHistory=(rows)=>{
  const text=(Array.isArray(rows)?rows:[]).map(historyText).join(' | ').toUpperCase();
  return /\b(CALL|PAGA|LIMP|IGUAL|RAISE|AUMENT|3-?BET|ALL-?IN|ALLIN|BET|APOST)\b/.test(text);
};

/**
 * Conservative replay-only fallback for nodes that Vision can prove from state
 * even when transient action text was missed.
 *
 * - RFI is inferred only when the pot still equals the posted blinds and there is
 *   no strategic action in history.
 * - vs_open is inferred only when Hero is demonstrably facing aggression AND the
 *   metadata says exactly one opponent remains active, with all opponent activity
 *   flags explicitly known. That sole opponent supplies the opener position.
 */
export function inferReplayPreflopContext(state={}){
  if(Array.isArray(state.board)&&state.board.length)return {node:null,versus:null,source:null};
  const heroPosition=normalizeReplayPosition(state.heroPosition)||deriveReplayHeroPosition(state.seats);
  const legal=new Set((state.legalActions||[]).map(x=>String(x).toUpperCase()));
  const toCall=numberText(state.toCall),pot=numberText(state.pot),blinds=blindsFromText(state.blinds);
  const hasStrategic=strategicHistory(state.actionHistory);

  if(!hasStrategic&&heroPosition&&heroPosition!=='BB'&&blinds&&pot!=null&&legal.has('RAISE')){
    const posted=blinds.sb+blinds.bb,eps=Math.max(.002,blinds.bb*.12);
    if(Math.abs(pot-posted)<=eps){
      return {node:'rfi',versus:null,source:'posted-blinds-only'};
    }
  }

  const facingAggression=legal.has('CALL')&&toCall!=null&&toCall>0&&(
    heroPosition==='BB'||!blinds||toCall>blinds.bb+Math.max(.0001,blinds.bb*.05)
  );
  if(!facingAggression)return {node:null,versus:null,source:null};

  const opponents=(Array.isArray(state.seats)?state.seats:[]).filter(r=>r&&!r.isHero);
  const flagsKnown=opponents.length>=1&&opponents.every(r=>typeof r.isActive==='boolean');
  const active=opponents.filter(r=>r.isActive===true);
  if(flagsKnown&&active.length===1){
    const versus=normalizeReplayPosition(active[0]?.position);
    if(versus&&versus!==heroPosition)return {node:'vs_open',versus,source:'sole-active-opponent'};
  }
  return {node:null,versus:null,source:null};
}

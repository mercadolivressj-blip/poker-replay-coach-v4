const RANKS='23456789TJQKA';
const SUITS='cdhs';
const DECK=[...RANKS].flatMap(rank=>[...SUITS].map(suit=>`${rank}${suit}`));
const TEXTURES=new Set(['dry','paired','two-tone','monotone','connected','high-card','low-card','dynamic']);
const rankIndex=card=>RANKS.indexOf(String(card||'')[0]?.toUpperCase());
const suitOf=card=>String(card||'')[1]?.toLowerCase();
const CARD=/^[2-9TJQKA][cdhs]$/;

const fnv1a=text=>{
  let h=0x811c9dc5;
  for(let i=0;i<String(text).length;i++){h^=String(text).charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}
  return h>>>0;
};

function rankCounts(board){
  const map=new Map();
  for(const card of board) map.set(card[0],(map.get(card[0])||0)+1);
  return map;
}
function suitCounts(board){
  const map=new Map();
  for(const card of board) map.set(suitOf(card),(map.get(suitOf(card))||0)+1);
  return map;
}
function connectedScore(board){
  const ranks=[...new Set(board.map(rankIndex))].sort((a,b)=>a-b);
  if(ranks.length<2)return 0;
  let adjacent=0;
  for(let i=1;i<ranks.length;i++) if(ranks[i]-ranks[i-1]<=2) adjacent++;
  const span=ranks.at(-1)-ranks[0];
  return adjacent+(span<=4?1:0);
}

export function classifyFlopBoard(board=[]){
  const cards=Array.isArray(board)?board.map(String):[];
  const valid=cards.length===3&&cards.every(c=>CARD.test(c))&&new Set(cards).size===3;
  if(!valid) return {valid:false,textures:[],checks:{}};
  const ranks=rankCounts(cards),suits=suitCounts(cards);
  const paired=[...ranks.values()].some(n=>n>=2);
  const monotone=suits.size===1;
  const twoTone=suits.size===2&&[...suits.values()].some(n=>n===2);
  const rainbow=suits.size===3;
  const idx=cards.map(rankIndex);
  const high=Math.max(...idx),low=Math.min(...idx);
  const connected=connectedScore(cards)>=2;
  const highCard=high>=RANKS.indexOf('Q');
  const lowCard=high<=RANKS.indexOf('9');
  const dry=!paired&&rainbow&&!connected;
  const dynamic=!paired&&twoTone&&connected;
  const checks={dry,paired,'two-tone':twoTone,monotone,connected,'high-card':highCard,'low-card':lowCard,dynamic,rainbow,rankSpan:high-low};
  return {valid:true,textures:Object.entries(checks).filter(([k,v])=>TEXTURES.has(k)&&v===true).map(([k])=>k),checks};
}

const cache=new Map();
function candidateBoards(texture){
  if(!TEXTURES.has(texture)) throw new TypeError(`unsupported texture: ${texture}`);
  if(cache.has(texture)) return cache.get(texture);
  const out=[];
  for(let a=0;a<DECK.length-2;a++){
    for(let b=a+1;b<DECK.length-1;b++){
      for(let c=b+1;c<DECK.length;c++){
        const board=[DECK[a],DECK[b],DECK[c]];
        if(classifyFlopBoard(board).checks[texture]===true) out.push(board);
      }
    }
  }
  if(!out.length) throw new Error(`no boards available for texture ${texture}`);
  cache.set(texture,Object.freeze(out.map(board=>Object.freeze(board))));
  return cache.get(texture);
}

export function materializeFlopBoard({textureClass,seed,excludeCards=[]}={}){
  const texture=String(textureClass||'').toLowerCase();
  if(!TEXTURES.has(texture)) return {ok:false,errors:['texture_unsupported'],board:null,proof:null};
  const excluded=new Set(Array.isArray(excludeCards)?excludeCards.map(String):[]);
  if([...excluded].some(card=>!CARD.test(card))) return {ok:false,errors:['excluded_card_invalid'],board:null,proof:null};
  const candidates=candidateBoards(texture);
  const start=fnv1a(`${texture}|${seed??0}`)%candidates.length;
  let board=null;
  for(let offset=0;offset<candidates.length;offset++){
    const row=candidates[(start+offset)%candidates.length];
    if(row.every(card=>!excluded.has(card))){board=[...row];break;}
  }
  if(!board) return {ok:false,errors:['no_board_after_exclusions'],board:null,proof:null};
  const proof=classifyFlopBoard(board);
  if(!proof.valid||proof.checks[texture]!==true) return {ok:false,errors:['board_texture_self_proof_failed'],board,proof};
  return {
    version:'cash-pro-lab-board-factory-v1',
    ok:true,
    errors:[],
    textureClass:texture,
    seed:seed??0,
    board,
    proof,
    provenance:{generator:'exhaustive-52-card-flop-filter-v1',candidateCount:candidates.length,excludedCards:[...excluded]},
  };
}

export function supportedBoardTextures(){return [...TEXTURES];}

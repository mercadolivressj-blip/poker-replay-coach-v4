const RANKS='23456789TJQKA',SUITS='cdhs';
const rv=r=>RANKS.indexOf(String(r).toUpperCase())+2;
export function parseCard(code){const s=String(code||'').trim();if(!/^[2-9TJQKA][cdhs]$/i.test(s))throw new Error(`bad_card:${code}`);return{code:s[0].toUpperCase()+s[1].toLowerCase(),rank:s[0].toUpperCase(),suit:s[1].toLowerCase(),value:rv(s[0])}}
export function deck(){const out=[];for(const r of RANKS)for(const s of SUITS)out.push(r+s);return out}

function straightHigh(values){const set=new Set(values);if(set.has(14))set.add(1);let run=0,last=null,best=0;for(const v of [...set].sort((a,b)=>a-b)){run=last!=null&&v===last+1?run+1:1;last=v;if(run>=5)best=v}return best===1?5:best}
function lex(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]||0)-(b[i]||0);if(d)return d}return 0}

export function scoreFive(codes){
 if(codes.length!==5)throw new Error('score_five_requires_5');const c=codes.map(parseCard);if(new Set(c.map(x=>x.code)).size!==5)throw new Error('duplicate_card');
 const values=c.map(x=>x.value).sort((a,b)=>b-a),counts=new Map();for(const x of values)counts.set(x,(counts.get(x)||0)+1);
 const groups=[...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);const flush=c.every(x=>x.suit===c[0].suit),sh=straightHigh(values);
 if(flush&&sh)return{tier:8,tie:[sh],name:'straight-flush'};
 if(groups[0][1]===4)return{tier:7,tie:[groups[0][0],groups[1][0]],name:'quads'};
 if(groups[0][1]===3&&groups[1][1]===2)return{tier:6,tie:[groups[0][0],groups[1][0]],name:'full-house'};
 if(flush)return{tier:5,tie:values,name:'flush'};
 if(sh)return{tier:4,tie:[sh],name:'straight'};
 if(groups[0][1]===3)return{tier:3,tie:[groups[0][0],...groups.slice(1).map(x=>x[0]).sort((a,b)=>b-a)],name:'trips'};
 if(groups[0][1]===2&&groups[1][1]===2)return{tier:2,tie:[Math.max(groups[0][0],groups[1][0]),Math.min(groups[0][0],groups[1][0]),groups[2][0]],name:'two-pair'};
 if(groups[0][1]===2)return{tier:1,tie:[groups[0][0],...groups.slice(1).map(x=>x[0]).sort((a,b)=>b-a)],name:'pair'};
 return{tier:0,tie:values,name:'high-card'};
}

export function compareScores(a,b){return a.tier!==b.tier?a.tier-b.tier:lex(a.tie,b.tie)}
function choose(arr,k,start=0,pick=[],out=[]){if(pick.length===k){out.push([...pick]);return out}for(let i=start;i<=arr.length-(k-pick.length);i++){pick.push(arr[i]);choose(arr,k,i+1,pick,out);pick.pop()}return out}

export function evaluateSeven(codes){
 if(codes.length<5||codes.length>7)throw new Error('evaluate_requires_5_to_7');const normalized=codes.map(parseCard).map(x=>x.code);if(new Set(normalized).size!==normalized.length)throw new Error('duplicate_card');
 let best=null;for(const five of choose(normalized,5)){const s=scoreFive(five);if(!best||compareScores(s,best)>0)best=s}return best;
}

export function compareHoldem(hero,villain,board){
 if(hero.length!==2||villain.length!==2||board.length!==5)throw new Error('compare_holdem_shape');const all=[...hero,...villain,...board].map(parseCard).map(x=>x.code);if(new Set(all).size!==9)throw new Error('duplicate_card');
 const hs=evaluateSeven([...hero,...board]),vs=evaluateSeven([...villain,...board]);return{result:Math.sign(compareScores(hs,vs)),hero:hs,villain:vs};
}

export function remainingDeck(known=[]){const used=new Set(known.map(parseCard).map(x=>x.code));return deck().filter(c=>!used.has(parseCard(c).code))}

export function exactEquityVsHand(hero,villain,board=[]){
 if(hero.length!==2||villain.length!==2||board.length>5)throw new Error('equity_shape');const known=[...hero,...villain,...board].map(parseCard).map(x=>x.code);if(new Set(known).size!==known.length)throw new Error('duplicate_card');
 const need=5-board.length,rem=remainingDeck(known);let win=0,tie=0,lose=0,total=0;
 for(const run of choose(rem,need)){const r=compareHoldem(hero,villain,[...board,...run]).result;total++;if(r>0)win++;else if(r<0)lose++;else tie++}
 return{win,tie,lose,total,equity:total?(win+tie*.5)/total:0};
}

// Browser-safe deterministic postflop policy for standalone runtime.
// ZERO imports: safe to load directly from the published HTML.
// This is intentionally conservative and only acts when the current legal buttons
// and enough table state are known. It never uses the old "showdown value = call" fallback.

const RANK = {2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,T:10,J:11,Q:12,K:13,A:14};
const LABEL = {FOLD:'DESISTIR',CHECK:'PASSAR',CALL:'PAGAR',BET:'APOSTAR',RAISE:'AUMENTAR',ALLIN:'ALL-IN'};

function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function card(c){const s=String(c||'').trim();if(s.length<2)return null;const r=RANK[s[0].toUpperCase()],su=s.at(-1).toLowerCase();return r&&'shdc'.includes(su)?{r,s:su}:null}
function straightHigh(ranks){const u=[...new Set(ranks)].sort((a,b)=>a-b);if(u.includes(14))u.unshift(1);let run=1,best=0;for(let i=1;i<u.length;i++){if(u[i]===u[i-1]+1){run++;if(run>=5)best=u[i]}else if(u[i]!==u[i-1])run=1}return best}
function eval7(cards){const cs=cards.map(card).filter(Boolean), byR=new Map(), byS=new Map();for(const c of cs){byR.set(c.r,(byR.get(c.r)||0)+1);if(!byS.has(c.s))byS.set(c.s,[]);byS.get(c.s).push(c.r)}const groups=[...byR.entries()].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);const flush=[...byS.entries()].find(([,rs])=>rs.length>=5);if(flush&&straightHigh(flush[1]))return{cat:8,name:'straight flush'};if(groups[0]?.[1]===4)return{cat:7,name:'quadra'};const trips=groups.filter(x=>x[1]>=3),pairs=groups.filter(x=>x[1]>=2);if(trips.length&&(trips.length>1||pairs.some(x=>x[0]!==trips[0][0])))return{cat:6,name:'full house'};if(flush)return{cat:5,name:'flush'};if(straightHigh(cs.map(x=>x.r)))return{cat:4,name:'sequência'};if(groups[0]?.[1]===3)return{cat:3,name:'trinca'};if(pairs.length>=2)return{cat:2,name:'dois pares'};if(pairs.length===1)return{cat:1,name:'um par'};return{cat:0,name:'carta alta'}}
function drawInfo(hero,board){const all=[...hero,...board].map(card).filter(Boolean);const suits={s:0,h:0,d:0,c:0};for(const c of all)suits[c.s]++;const flushDraw=Math.max(...Object.values(suits))===4;const ranks=[...new Set(all.map(x=>x.r))];if(ranks.includes(14))ranks.push(1);let max4=0;for(let lo=1;lo<=10;lo++){let k=0;for(let r=lo;r<lo+5;r++)if(ranks.includes(r))k++;max4=Math.max(max4,k)}return{flushDraw,straightDraw:max4===4}}
function pairClass(hero,board){const h=hero.map(card),b=board.map(card).filter(Boolean);if(h.some(x=>!x)||!b.length)return'unknown';const br=b.map(x=>x.r).sort((a,b)=>b-a),hr=h.map(x=>x.r).sort((a,b)=>b-a);const boardMax=br[0];if(hr[0]===hr[1]){if(hr[0]>boardMax)return'overpair';if(br.includes(hr[0]))return'set-ish';return'underpair'}const paired=hr.filter(r=>br.includes(r));if(!paired.length)return'none';const r=Math.max(...paired);const uniq=[...new Set(br)].sort((a,b)=>b-a);if(r===uniq[0])return'top-pair';if(r===uniq.at(-1))return'bottom-pair';return'middle-pair'}
function legalDecision(legal,preferred){for(const a of preferred)if(legal.has(a))return LABEL[a];return null}

export function postflopPolicyV4Decision(state, context = {}) {
  const legal=new Set(Array.isArray(state?.legalActions)?state.legalActions:[]), hero=Array.isArray(state?.heroCards)?state.heroCards:[], board=Array.isArray(state?.board)?state.board:[];
  if(board.length<3||hero.length!==2)return{decision:null,engine:'POSTFLOP LOCAL',reason:'Cartas insuficientes para avaliar o pós-flop.'};
  const all=[...hero,...board], made=eval7(all), draw=drawInfo(hero,board), pc=pairClass(hero,board), pot=n(state?.pot), call=n(state?.toCall), st=board.length>=5?'river':board.length===4?'turn':'flop';
  if(legal.has('CHECK')&&!legal.has('CALL')){
    let pref=['CHECK'];
    if(legal.has('BET')){
      if(made.cat>=2||(made.cat===1&&(pc==='top-pair'||pc==='overpair'))||(st!=='river'&&(draw.flushDraw||draw.straightDraw)))pref=['BET','CHECK'];
    }
    const d=legalDecision(legal,pref);return{decision:d,engine:'POSTFLOP LOCAL · CHECK/BET',confidence:72,reason:`${made.name}${pc!=='none'&&pc!=='unknown'?` (${pc})`:''}. Sem aposta pendente; ação escolhida somente entre os botões atuais.`};
  }
  if(!legal.has('CALL')||call==null||call<=0||pot==null||pot<=0)return{decision:null,engine:'POSTFLOP LOCAL · ESTADO INCOMPLETO',reason:'Há decisão paga, mas pote/valor para pagar ainda não estão confirmados localmente.'};
  const frac=call/pot, odds=call/(pot+call);let pref=['FOLD'],why='força insuficiente para o preço atual';
  if(made.cat>=3){pref=legal.has('RAISE')&&frac<=.75?['RAISE','CALL']:['CALL'];why=`${made.name} é mão forte para continuar`;}
  else if(made.cat===2){pref=frac<=1.25?['CALL']:['FOLD'];why=`dois pares; sizing ${(frac*100).toFixed(0)}% do pote`;}
  else if(made.cat===1){
    if(pc==='overpair'||pc==='top-pair'){
      const lim=st==='river'?.65:st==='turn'?.85:1.0;pref=frac<=lim?['CALL']:['FOLD'];why=`${pc}; limite conservador por street/sizing`;
    }else if(pc==='middle-pair'||pc==='bottom-pair'||pc==='underpair'){
      const lim=st==='flop'?(draw.flushDraw||draw.straightDraw?.60:.48):st==='turn'?(draw.flushDraw||draw.straightDraw?.45:.32):.20;pref=frac<=lim?['CALL']:['FOLD'];why=`${pc}; bluff-catcher fraco, decisão guiada pelo preço`;
    }else{pref=frac<=.35?['CALL']:['FOLD'];why='par sem classificação forte; linha conservadora';}
  }else if(st!=='river'&&(draw.flushDraw||draw.straightDraw)){
    const lim=draw.flushDraw&&draw.straightDraw?.9:.65;pref=frac<=lim?['CALL']:['FOLD'];why=`draw ${draw.flushDraw?'de flush ':''}${draw.straightDraw?'de sequência':''}; preço comparado às odds`;
  }
  const d=legalDecision(legal,pref);return{decision:d,engine:'POSTFLOP LOCAL · POT ODDS',confidence:68,reason:`${why}. Pagar ${call.toFixed(2)} em pote ${pot.toFixed(2)}: pot odds ${(odds*100).toFixed(1)}%. Não usa fallback automático de call.`};
}

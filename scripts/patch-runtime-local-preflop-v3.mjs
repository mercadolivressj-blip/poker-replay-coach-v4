import fs from 'node:fs';

const runtimePath='standalone-lab/study-runtime-public-v1.html';
let s=fs.readFileSync(runtimePath,'utf8');
const legacyMarker='// V3_COMPAT_MARKERS: BUILD V3 | BRAIN LOCAL PREFLOP V3 | preflop-local-v3';
const ensureLegacyMarker=()=>{if(!s.includes(legacyMarker))s=s.replace('</script>',legacyMarker+'\n</script>')};

if(s.includes('SSJ STUDY RUNTIME V1 · BUILD V4')&&s.includes('inferReplayPreflopContext')){
  ensureLegacyMarker();
  fs.writeFileSync(runtimePath,s);
  console.log('runtime replay preflop V4 already patched');
  process.exit(0);
}

const rep=(from,to,label)=>{if(!s.includes(from))throw new Error('missing '+label);s=s.replace(from,to)};

rep('SSJ STUDY RUNTIME V1 · BUILD V3','SSJ STUDY RUNTIME V1 · BUILD V4','build label');

rep(
"import { preflopDecision as localPreflopDecision } from 'https://cdn.jsdelivr.net/gh/mercadolivressj-blip/poker-replay-coach-v4@8acb701cc11b42a3a5ec4d13af899f7ff9269e00/src/brain/preflop.js';",
"import { preflopDecision as localPreflopDecision } from 'https://cdn.jsdelivr.net/gh/mercadolivressj-blip/poker-replay-coach-v4@8acb701cc11b42a3a5ec4d13af899f7ff9269e00/src/brain/preflop.js';\nimport { deriveReplayHeroPosition, inferReplayPreflopContext } from 'https://cdn.jsdelivr.net/gh/mercadolivressj-blip/poker-replay-coach-v4@e4561e10782a62f632c6461168c82c6c88d00eef/src/core/replay-preflop-context.js';",
'replay preflop context import');

rep(
`function captureSeatMap(){
  const slots=activeVisualSlots();if(slots.length<2)return{};
  if(lockedDealerSeat){const local=positionsFromDealer(slots,lockedDealerSeat);if(local.hero)return local;}
  const heroPos=state.heroPosition||lockedPosition;if(!heroPos)return{};
  const positions=POSITIONS_BY_N[slots.length];if(!positions)return{};const heroIndex=positions.indexOf(heroPos);if(heroIndex<0)return{};
  const map={};slots.forEach((slot,i)=>map[slot]=positions[(heroIndex+i)%positions.length]);return map;
}`,
`function captureSeatMap(){
  // This runtime is explicitly 6-max. Once the dealer is locked, map against the
  // full physical ring so a player who already folded cannot disappear from the
  // position map and shift every remaining seat.
  const slots=lockedDealerSeat?[...VISUAL_ORDER]:activeVisualSlots();if(slots.length<2)return{};
  if(lockedDealerSeat){const local=positionsFromDealer(slots,lockedDealerSeat);if(local.hero)return local;}
  const heroPos=state.heroPosition||lockedPosition;if(!heroPos)return{};
  const positions=POSITIONS_BY_N[slots.length];if(!positions)return{};const heroIndex=positions.indexOf(heroPos);if(heroIndex<0)return{};
  const map={};slots.forEach((slot,i)=>map[slot]=positions[(heroIndex+i)%positions.length]);return map;
}`,
'capture seat map');

rep(
`  const remote=[...remoteActionHistory],localStrategic=strategicActionCount(rows),remoteStrategic=strategicActionCount(remote);
  state.actionHistory=localStrategic>0?rows:(remoteStrategic>0?remote:(rows.length?rows:remote));`,
`  const remote=[...remoteActionHistory],localStrategic=strategicActionCount(rows),remoteStrategic=strategicActionCount(remote);
  // Stabilized Vision history is broader than transient local OCR, so it wins when
  // it contains a strategic action. Local capture remains the fallback.
  state.actionHistory=remoteStrategic>0?remote:(localStrategic>0?rows:(remote.length?remote:rows));`,
'history authority');

rep(
`  const slots=activeVisualSlots(),layoutKey=slots.join('|');
  if(seatLayoutCandidate===layoutKey)seatLayoutVotes++;else{seatLayoutCandidate=layoutKey;seatLayoutVotes=1;}
  if(dealerVotes<6||seatLayoutVotes<6||slots.length<2||!slots.includes(hit.seatId))return;
  const map=positionsFromDealer(slots,hit.seatId),heroPos=map.hero;if(!heroPos)return;`,
`  // Dealer detection itself is sovereign for the physical button. Do not require
  // the dealer seat to still show hole cards: it may have folded before the local
  // card-presence detector stabilized. The study runtime is fixed to PokerStars 6-max.
  const slots=[...VISUAL_ORDER];
  if(dealerVotes<6)return;
  const map=positionsFromDealer(slots,hit.seatId),heroPos=map.hero;if(!heroPos)return;`,
'dealer full ring');

rep(
`function derivePosition(seats){
  if(!Array.isArray(seats))return null;const a=seats.filter(x=>x&&x.isActive!==false);if(a.length<2)return null;
  const d=a.findIndex(x=>x.isDealer),h=a.findIndex(x=>x.isHero);if(d<0||h<0)return null;
  const diff=(h-d+a.length)%a.length;
  if(a.length>=6)return ['BTN','SB','BB','UTG','HJ','CO'][diff]||null;
  if(a.length===5)return ['BTN','SB','BB','UTG','CO'][diff]||null;
  if(a.length===4)return ['BTN','SB','BB','CO'][diff]||null;
  if(a.length===3)return ['BTN','SB','BB'][diff]||null;
  return diff===0?'SB':'BB';
}`,
`function derivePosition(seats){return deriveReplayHeroPosition(seats)}`,
'derive position');

rep(
`  const manualNode=$('manualNode')?.value||'';
  const node=manualNode==='rfi'?'rfi':manualNode?'vs_open':null;
  const versus=manualNode&&manualNode!=='rfi'?manualNode:null;
  const effectiveState={...state,heroPosition:gate.effectivePos};`,
`  const manualNode=$('manualNode')?.value||'';
  const effectiveState={...state,heroPosition:gate.effectivePos};
  const autoPreflop=effectiveState.board.length===0?inferReplayPreflopContext(effectiveState):{node:null,versus:null,source:null};
  const node=manualNode==='rfi'?'rfi':manualNode?'vs_open':autoPreflop.node;
  const versus=manualNode&&manualNode!=='rfi'?manualNode:autoPreflop.versus;
  if(!manualNode&&autoPreflop.source)log('PREFLOP CONTEXT AUTO · '+autoPreflop.source+' · '+(node||'')+(versus?' vs '+versus:''));`,
'auto preflop context');

rep("log('BRAIN LOCAL PREFLOP V3 · '+(d?.engine||'BRAIN GATE'));","log('BRAIN LOCAL PREFLOP V4 · '+(d?.engine||'BRAIN GATE'));",'brain log');
rep("'preflop-local-v3 · '+(j.service||'poker-strategy-brain')","'preflop-replay-v4 · '+(j.service||'poker-strategy-brain')",'backend online label');
rep("'preflop-local-v3 · pós-flop remoto indisponível: '+e.message","'preflop-replay-v4 · pós-flop remoto indisponível: '+e.message",'backend offline label');

ensureLegacyMarker();
fs.writeFileSync(runtimePath,s);
console.log('runtime replay preflop V4 patched');

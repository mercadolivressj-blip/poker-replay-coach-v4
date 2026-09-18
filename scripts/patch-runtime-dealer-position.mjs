import fs from 'node:fs';
const path='standalone-lab/study-runtime-public-v1.html';
let s=fs.readFileSync(path,'utf8');
const must=(from,to,label)=>{if(!s.includes(from))throw new Error('missing '+label);s=s.replace(from,to);};

must(
"import { shouldAcceptOcrAction } from 'https://cdn.jsdelivr.net/gh/mercadolivressj-blip/poker-replay-coach-v4@f6ad1a9ed61e7a03538acba3059e6bb79d6da387/src/core/action-ocr-gate.js';",
"import { shouldAcceptOcrAction } from 'https://cdn.jsdelivr.net/gh/mercadolivressj-blip/poker-replay-coach-v4@f6ad1a9ed61e7a03538acba3059e6bb79d6da387/src/core/action-ocr-gate.js';\nimport { detectDealerButtonSeat, positionsFromDealer } from 'https://cdn.jsdelivr.net/gh/mercadolivressj-blip/poker-replay-coach-v4@e17c637c4364569d516bdf8626eeb801aafb13ac/src/core/dealer-button.js';",
'dealer import');

must(
"localConfirmedActions=[],remoteActionHistory=[],pendingCaptureEvents=[],localActionSeq=0,localSweepAt=0,localSweepIndex=0;",
"localConfirmedActions=[],remoteActionHistory=[],pendingCaptureEvents=[],localActionSeq=0,localSweepAt=0,localSweepIndex=0,dealerCandidate='',dealerVotes=0,lockedDealerSeat=null,seatLayoutCandidate='',seatLayoutVotes=0;",
'dealer state');

must(
`function captureSeatMap(){\n  const heroPos=state.heroPosition||lockedPosition,slots=activeVisualSlots();if(!heroPos||slots.length<2)return{};\n  const positions=POSITIONS_BY_N[slots.length];if(!positions)return{};const heroIndex=positions.indexOf(heroPos);if(heroIndex<0)return{};\n  const map={};slots.forEach((slot,i)=>map[slot]=positions[(heroIndex+i)%positions.length]);return map;\n}`,
`function captureSeatMap(){\n  const slots=activeVisualSlots();if(slots.length<2)return{};\n  if(lockedDealerSeat){const local=positionsFromDealer(slots,lockedDealerSeat);if(local.hero)return local;}\n  const heroPos=state.heroPosition||lockedPosition;if(!heroPos)return{};\n  const positions=POSITIONS_BY_N[slots.length];if(!positions)return{};const heroIndex=positions.indexOf(heroPos);if(heroIndex<0)return{};\n  const map={};slots.forEach((slot,i)=>map[slot]=positions[(heroIndex+i)%positions.length]);return map;\n}`,
'capture seat map');

must(
"localActionSeq=0;localSweepAt=0;localSweepIndex=0;brainSession=null;positionCandidate='';positionVotes=0;",
"localActionSeq=0;localSweepAt=0;localSweepIndex=0;dealerCandidate='';dealerVotes=0;lockedDealerSeat=null;seatLayoutCandidate='';seatLayoutVotes=0;brainSession=null;positionCandidate='';positionVotes=0;",
'dealer reset');

const marker=`function actionTick(ts){\n`;
if(!s.includes(marker))throw new Error('missing actionTick marker');
const helper=`function observeLocalDealer(img,aw,ah,now){\n  const hit=detectDealerButtonSeat(img?.data,aw,ah,localFelt);if(!hit?.seatId)return;\n  if(dealerCandidate===hit.seatId)dealerVotes++;else{dealerCandidate=hit.seatId;dealerVotes=1;}\n  const slots=activeVisualSlots(),layoutKey=slots.join('|');\n  if(seatLayoutCandidate===layoutKey)seatLayoutVotes++;else{seatLayoutCandidate=layoutKey;seatLayoutVotes=1;}\n  if(dealerVotes<4||seatLayoutVotes<4||slots.length<2||!slots.includes(hit.seatId))return;\n  const map=positionsFromDealer(slots,hit.seatId),heroPos=map.hero;if(!heroPos)return;\n  if(lockedDealerSeat===hit.seatId&&lockedPosition===heroPos){fieldSeen.position=now;return;}\n  const previous=lockedPosition;lockedDealerSeat=hit.seatId;lockedPosition=heroPos;state.heroPosition=heroPos;fieldSeen.position=now;positionCandidate=heroPos;positionVotes=99;\n  log((previous&&previous!==heroPos?'posição corrigida':'posição derivada')+' por dealer local: '+heroPos+' · dealer '+hit.seatId+' · '+slots.length+'-max');\n  refreshLocalHistory();lastBrainKey='';brainSoon();\n}\n`;
s=s.replace(marker,helper+marker);

must(
"localCaptureState=f.state;localSeatState=observeSeatCardState(localSeatState,localCaptureState,now);localSeatState=applyActionSeatEvents(localSeatState,f.events,now);",
"localCaptureState=f.state;localSeatState=observeSeatCardState(localSeatState,localCaptureState,now);localSeatState=applyActionSeatEvents(localSeatState,f.events,now);observeLocalDealer(img,aw,ah,now);",
'dealer observation');

fs.writeFileSync(path,s);
console.log('patched local dealer-position derivation');

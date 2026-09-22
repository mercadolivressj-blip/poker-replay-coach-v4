// trigger v3
import fs from 'node:fs';

const runtimePath='standalone-lab/study-runtime-public-v1.html';
let runtime=fs.readFileSync(runtimePath,'utf8');
const rep=(from,to,label)=>{if(!runtime.includes(from))throw new Error('runtime pattern missing: '+label);runtime=runtime.replace(from,to);};

rep("seatLayoutCandidate='',seatLayoutVotes=0;","seatLayoutCandidate='',seatLayoutVotes=0,lockedVisualSlots=[],lockedPositionSeatCount=0;",'state vars');
rep(`function activeVisualSlots(){\n  const known=VISUAL_ORDER.filter(id=>id==='hero'||localSeatState?.seats?.[id]?.seenCards===true);\n  return known.length>=2?known:[];\n}`,
`function activeVisualSlots(){\n  const observed=VISUAL_ORDER.filter(id=>id==='hero'||localSeatState?.seats?.[id]?.seenCards===true);\n  // Seats dealt into the hand are monotonic: folds must never shrink the table and remap positions.\n  const merged=VISUAL_ORDER.filter(id=>lockedVisualSlots.includes(id)||observed.includes(id));\n  if(merged.length>lockedVisualSlots.length)lockedVisualSlots=merged;\n  return lockedVisualSlots.length>=2?[...lockedVisualSlots]:[];\n}`,'monotonic seats');
rep("dealerCandidate='';dealerVotes=0;lockedDealerSeat=null;seatLayoutCandidate='';seatLayoutVotes=0;brainSession=null;positionCandidate='';positionVotes=0;",
"dealerCandidate='';dealerVotes=0;lockedDealerSeat=null;seatLayoutCandidate='';seatLayoutVotes=0;lockedVisualSlots=[];lockedPositionSeatCount=0;brainSession=null;positionCandidate='';positionVotes=0;",'reset seat lock');
rep("  const street=state.board.length>=5?'river':state.board.length===4?'turn':state.board.length>=3?'flop':'preflop';\n  const recent=localConfirmedActions.slice(-8).find(a=>a.seatId===seatId&&a.action===action&&String(a.amount??'')===String(amount??'')&&at-a.at<1800);if(recent)return;",
"  const street=state.board.length>=5?'river':state.board.length===4?'turn':state.board.length>=3?'flop':'preflop';\n  // A player can fold only once per hand. Never let repeated visual motion/OCR spam the ledger.\n  if(action==='FOLD'&&localConfirmedActions.some(a=>a.seatId===seatId&&a.action==='FOLD'))return;\n  const recent=localConfirmedActions.slice(-8).find(a=>a.seatId===seatId&&a.action===action&&String(a.amount??'')===String(amount??'')&&at-a.at<1800);if(recent)return;",'fold dedupe');
rep("  const hit=detectDealerButtonSeat(img?.data,aw,ah,localFelt);if(!hit?.seatId)return;\n  if(dealerCandidate===hit.seatId)dealerVotes++;else{dealerCandidate=hit.seatId;dealerVotes=1;}",
"  const hit=detectDealerButtonSeat(img?.data,aw,ah,localFelt);if(!hit?.seatId)return;\n  // Dealer cannot move inside the same hand. Ignore later conflicting visual hits once locked.\n  if(lockedDealerSeat&&hit.seatId!==lockedDealerSeat)return;\n  if(dealerCandidate===hit.seatId)dealerVotes++;else{dealerCandidate=hit.seatId;dealerVotes=1;}", 'dealer immutable');
rep("  if(dealerVotes<4||seatLayoutVotes<4||slots.length<2||!slots.includes(hit.seatId))return;\n  const map=positionsFromDealer(slots,hit.seatId),heroPos=map.hero;if(!heroPos)return;\n  if(lockedDealerSeat===hit.seatId&&lockedPosition===heroPos){fieldSeen.position=now;return;}\n  const previous=lockedPosition;lockedDealerSeat=hit.seatId;lockedPosition=heroPos;state.heroPosition=heroPos;fieldSeen.position=now;positionCandidate=heroPos;positionVotes=99;",
"  if(dealerVotes<6||seatLayoutVotes<6||slots.length<2||!slots.includes(hit.seatId))return;\n  const map=positionsFromDealer(slots,hit.seatId),heroPos=map.hero;if(!heroPos)return;\n  // Never downgrade 6-max -> 5-max after folds. Only a newly observed dealt-in seat may upgrade the mapping.\n  if(lockedDealerSeat===hit.seatId&&lockedPosition&&slots.length<=lockedPositionSeatCount){fieldSeen.position=now;return;}\n  const previous=lockedPosition;lockedDealerSeat=hit.seatId;lockedPosition=heroPos;lockedPositionSeatCount=slots.length;state.heroPosition=heroPos;fieldSeen.position=now;positionCandidate=heroPos;positionVotes=99;",'stable dealer mapping');
fs.writeFileSync(runtimePath,runtime);

const preflopPath='src/brain/preflop.js';
let pre=fs.readFileSync(preflopPath,'utf8');
const prep=(from,to,label)=>{if(!pre.includes(from))throw new Error('preflop pattern missing: '+label);pre=pre.replace(from,to);};
prep("import { effectiveDepthBB, parseChips } from './math.js';","import { effectiveDepthBB, parseChips, parseBlinds } from './math.js';",'parseBlinds import');
prep(" const facingCost=legalSet.has('CALL') && ((parseChips(state.toCall)??0)>0);",
` const callCost=parseChips(state.toCall)??0;\n const bigBlind=parseBlinds(state.blinds)?.bb??null;\n // CALL does not automatically mean we face an opener: UTG/HJ/CO/BTN in an unopened pot\n // naturally have to call one big blind to limp. BB is different: without aggression it has CHECK.\n const facingCost=legalSet.has('CALL') && callCost>0 && (position==='BB' || bigBlind==null || callCost>bigBlind+Math.max(.0001,bigBlind*.05));`, 'facing-cost semantics');
fs.writeFileSync(preflopPath,pre);
console.log('patched runtime + preflop v3');

import assert from 'node:assert/strict';
import { decideBrain, enforceLegal } from '../src/brain/decision.js';

const base={version:'vision-v1',heroCards:['Ah','Kd'],heroPresence:'present',board:[],boardPresence:'absent',pot:'0.03',toCall:null,legalActions:['FOLD','RAISE'],players:6,activePlayers:6,heroPosition:'CO',heroStack:'2.00',effectiveStack:'2.00',blinds:'0.01/0.02',seats:[],actionHistory:[],confidence:.99,readerModel:'flash-lite',capturedAt:Date.now()};

// Legal-action mask is sovereign.
const blocked=enforceLegal({decision:'PAGAR',engine:'X',confidence:90,reason:'x'},base);
assert.equal(blocked.decision,null);
assert.equal(blocked.engine,'LEGAL MASK');

// Missing position must not invent a preflop decision.
const noPos=decideBrain({...base,heroPosition:null},{format:'cash'});
assert.equal(noPos.decision,null);

// Every non-null decision must map to a confirmed legal action.
for(const state of [
  base,
  {...base,heroCards:['7c','2d'],heroPosition:'UTG'},
  {...base,board:['Ac','7d','2s'],boardPresence:'present',legalActions:['CHECK','BET'],toCall:null},
  {...base,board:['Ac','7d','2s'],boardPresence:'present',legalActions:['FOLD','CALL'],toCall:'0.02'},
]){
 const d=decideBrain(state,{format:'cash'});
 if(d.decision) assert.ok(state.legalActions.includes(d.actionCode),`${d.decision} must be legal`);
}

// Check-only state must never fabricate fold/call/raise.
const checkOnly=decideBrain({...base,board:['Ac','7d','2s'],boardPresence:'present',legalActions:['CHECK'],toCall:null},{format:'cash'});
if(checkOnly.decision) assert.equal(checkOnly.actionCode,'CHECK');

console.log('brain-v1 smoke: OK');

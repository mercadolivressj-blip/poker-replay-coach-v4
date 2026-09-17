import assert from 'node:assert/strict';
import { buildLedgerFromState } from '../src/brain/action-ledger.js';
import { buildBrainKnowledge } from '../src/brain/knowledge.js';
import { decideBrain } from '../src/brain/decision.js';

const state={
  version:'vision-v1',
  heroCards:['Ah','Ad'], heroPresence:'present',
  board:['Kc','7d','2s'], boardPresence:'present',
  pot:'0.12', toCall:'0.04', legalActions:['FOLD','CALL','RAISE'],
  players:6, activePlayers:2, heroPosition:'BTN', heroStack:'1.80', effectiveStack:'1.20', blinds:'0.01/0.02',
  seats:[{name:'Hero',isHero:true},{name:'Villain'}],
  actionHistory:['Villain raises 0.05','Hero calls 0.03','*** FLOP ***','Hero checks','Villain bets 0.04'],
  confidence:.99, readerModel:'flash-lite', capturedAt:Date.now(),
};
const profiles={version:'player-model-v1',players:{
  Villain:{actor:'Villain',hands:40,vpipHands:20,pfrHands:6,threeBetHands:2,postflopAggressive:15,postflopCalls:20,postflopChecks:5,postflopFolds:4,showdowns:0,lastHandId:40}
}};

const ledger=buildLedgerFromState(state,{handId:41,heroActor:'Hero'});
const captureCandidates=[{status:'provisional',sovereign:false,street:'flop',seatId:'right-high',actor:'Villain',action:'RAISE',amount:null,confidence:.81,source:'local-action-text',capturedAt:1234}];
const k=buildBrainKnowledge(state,{ledger,profiles,captureCandidates});
assert.equal(k.version,'brain-knowledge-v1.1');
assert.equal(k.street,'flop');
assert.equal(k.hero.effectiveDepthBB,60);
assert.equal(k.math.requiredEquityPct,25);
assert.equal(k.math.spr,10);
assert.equal(k.line.preflopAggressor,'Villain');
assert.equal(k.line.currentStreetLastAggression.actor,'Villain');
assert.equal(k.line.currentStreetLastAggression.action,'BET');
assert.equal(k.line.facingBet,true);
assert.equal(k.table.multiway,false);
assert.equal(k.postflop.hand.name,'um par');
assert.equal(k.playerReads[0].actor,'Villain');
assert.equal(k.playerReads[0].label,'LOOSE-PASSIVO');
assert.equal(k.playerReads[0].confidence,'baixa');
assert.equal(k.completeness.completeForDecision,true);
assert.equal(k.completeness.hasPlayerSamples,true);
assert.equal(k.completeness.hasProvisionalLineEvidence,true);
assert.equal(k.line.provisionalObserved.length,1);
assert.equal(k.line.provisionalObserved[0].sovereign,false);
assert.equal(k.line.provisionalObserved[0].action,'RAISE');

const incomplete=buildBrainKnowledge({...state,heroPosition:null,activePlayers:null,players:null},{ledger,profiles:null});
assert(incomplete.completeness.missing.includes('heroPosition'));
assert(incomplete.completeness.missing.includes('activePlayers'));
assert.equal(incomplete.completeness.completeForDecision,false);

const r=decideBrain(state,{format:'cash',handId:41,heroActor:'Hero',profiles,ledger,captureCandidates});
assert.equal(r.knowledgeVersion,'brain-knowledge-v1.1');
assert.equal(r.strategyVersion,'strategy-v1-migration');
assert.equal(r.strategyStatus.preflop,'ported-and-regression-gated');
assert.equal(r.strategyStatus.postflop,'source-not-vendored-in-github');
assert.equal(r.strategyStatus.policyComplete,false);
assert.equal(r.knowledge.line.currentStreetLastAggression.actor,'Villain');
assert.equal(r.knowledge.line.provisionalObserved[0].action,'RAISE');

// Supplied session ledger must win over an incomplete snapshot actionHistory.
const snapshotMissingHistory={...state,actionHistory:[]};
const sessionDriven=decideBrain(snapshotMissingHistory,{format:'cash',handId:41,heroActor:'Hero',profiles,ledger,captureCandidates});
assert.equal(sessionDriven.knowledge.line.actionCount,ledger.actions.length);
assert.equal(sessionDriven.knowledge.line.preflopAggressor,'Villain');

console.log('brain-knowledge-v1 regressions: OK');

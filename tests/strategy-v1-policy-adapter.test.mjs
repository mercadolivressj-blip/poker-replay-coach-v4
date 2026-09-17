import assert from 'node:assert/strict';

await import('../scripts/generate-policy-v4-runtime.mjs');

const { buildLedgerFromState }=await import('../src/brain/action-ledger.js');
const { postflopPolicyV4Decision, policyHistoryFromLedger }=await import('../src/brain/postflop-policy-v4.js');

const state={
  version:'vision-v1',
  heroCards:['Ah','Qd'],heroPresence:'present',
  board:['Ks','7h','2d'],boardPresence:'present',
  pot:'20',toCall:null,legalActions:['CHECK','BET'],
  players:2,activePlayers:2,heroPosition:'BTN',
  heroStack:'100',effectiveStack:'100',blinds:'0.5/1',
  seats:[{name:'Hero',isHero:true},{name:'Villain'}],
  actionHistory:['Hero raises 2.5','Villain calls 2.5','*** FLOP ***','Villain checks'],
  confidence:.99,readerModel:'test',capturedAt:1,
};
const ledger=buildLedgerFromState(state,{handId:1,heroActor:'Hero'});
const history=policyHistoryFromLedger(ledger);
assert.deepEqual(history,['PREFLOP','Hero RAISE 2.5','Villain CALL 2.5','FLOP','Villain CHECK']);

const d=postflopPolicyV4Decision(state,{ledger,heroIsPreflopAggressor:true,heroInPosition:true,potType:'SRP'});
assert.ok(d.decision);
assert.equal(d.engine,'POLICY V4');
assert.equal(d.source,'strategy-v1-frozen');
assert.equal(d.details.frozenSourceCommit,'3efde306fbb1dda38584cb8ffee0c2245b6231f4');
assert.ok(d.details.policyProbabilities);
assert.ok(d.confidence>0);

const multi=postflopPolicyV4Decision({...state,activePlayers:3},{ledger,heroIsPreflopAggressor:true});
assert.equal(multi.engine,'HEURÍSTICA (FALLBACK)');

const gated=postflopPolicyV4Decision({...state,legalActions:[]},{ledger});
assert.equal(gated.decision,null);

const t8=postflopPolicyV4Decision({
  ...state,
  heroCards:['Tc','8d'],
  board:['3c','Qh','Jc','Ac','5s'],
  pot:'0.50',toCall:'0.23',legalActions:['FOLD','CALL','RAISE'],
  heroPosition:'BB',heroStack:'0.26',effectiveStack:'0.26',blinds:'0.01/0.02',
  actionHistory:['RIVER','S4 BET 0.23'],
},{ledger:null});
assert.notEqual(t8.decision,'ALL-IN');
assert.doesNotMatch(String(t8.decision),/^ALL-IN$/);

console.log('strategy-v1 Policy V4 Brain adapter: OK');

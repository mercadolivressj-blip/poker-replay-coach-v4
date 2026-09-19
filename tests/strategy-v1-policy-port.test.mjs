import assert from 'node:assert/strict';

await import('../scripts/generate-policy-v4-runtime.mjs');

const { analyzePostflop }=await import('../src/strategy-v1/runtime/postflop.js');
const { FEATURE_NAMES, policyFeatures }=await import('../src/strategy-v1/runtime/postflop-policy-features.js');
const { policyFeatureParity, policyMeta, runPolicy }=await import('../src/strategy-v1/runtime/postflop-policy.js');
const { policyDecision }=await import('../src/strategy-v1/runtime/postflop-policy-decision.js');

const spot=(over={})=>analyzePostflop({
  heroCards:['Ah','Qd'],
  board:['Ks','7h','2d'],
  pot:'20',
  toCall:null,
  legalActions:['CHECK','BET'],
  heroPosition:'IP',
  heroStack:'100',
  effectiveStack:'100',
  blinds:'0.5/1',
  activePlayers:2,
  actionHistory:['FLOP','OOP_CHECK'],
  potType:'SRP',
  heroInPosition:true,
  heroIsPreflopAggressor:true,
  ...over,
});

assert.equal(FEATURE_NAMES.length,74);
assert.equal(policyFeatureParity(),true);
const meta=policyMeta();
assert.equal(meta.version,'postflop-policy-v4');
assert.equal(meta.hash,'bb98bc8a27ec4bb634ff380ec1315c3bc4cc7605a81a65ce0ece2848a4e27181');
assert.equal(meta.nFeatures,74);
assert.equal(meta.nIterations,400);

const a=spot();
assert.deepEqual(policyFeatures(a),policyFeatures(a));
const p=runPolicy(a);
const sum=Object.values(p.probabilities).reduce((x,y)=>x+y,0);
assert.ok(Math.abs(sum-1)<1e-9);
assert.ok(['CHECK','BET'].includes(p.action));

for(const legalActions of [['CHECK','BET'],['FOLD','CALL'],['FOLD','CALL','RAISE']]){
  const x=spot({
    legalActions,
    toCall:legalActions.includes('CALL')?'8':null,
    pot:legalActions.includes('CALL')?'28':'20',
  });
  const r=runPolicy(x);
  assert.ok(r.action===null||legalActions.includes(r.action)||(r.action==='BET'&&legalActions.includes('RAISE')&&!legalActions.includes('CALL')));
}

assert.equal(policyDecision(spot({activePlayers:3})).engine,'HEURÍSTICA (FALLBACK)');
assert.equal(policyDecision(spot({board:['Ks','7h'],legalActions:[]})).engine,'HEURÍSTICA (FALLBACK)');

const lowCandidates=[
  {heroCards:['2c','3c'],board:['2s','Jd','Qh','Ac','9d'],pot:'4,71',toCall:'2,57',legalActions:['FOLD','CALL','RAISE'],heroStack:'48,82',blinds:'0,25/0,50'},
  {heroCards:['8h','7h'],board:['2s','Jd','Qh'],pot:'4,71',toCall:'2,57',legalActions:['FOLD','CALL','RAISE'],heroStack:'48,82',blinds:'0,25/0,50'},
  {heroCards:['Tc','9c'],board:['2s','7d','Qh','4c'],pot:'4,71',toCall:'2,57',legalActions:['FOLD','CALL','RAISE'],heroStack:'48,82',blinds:'0,25/0,50'},
];
const low=lowCandidates
  .map(input=>analyzePostflop(input))
  .find(x=>{const q=runPolicy(x);return !q.outOfDistribution&&q.action!==null&&q.probability<0.45;});
assert.ok(low,'frozen low-support oracle spot must still exist');
assert.equal(policyDecision(low).engine,'POLICY V4','final frozen V4 must not restore historical MIN_CONF=0.45 fallback');

console.log('strategy-v1 Policy V4 isolated port: OK');

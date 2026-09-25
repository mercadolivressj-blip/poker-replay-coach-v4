import assert from 'node:assert/strict';
import {generateRiverScenario,runRiverStressSuite,RIVER_TEMPLATES} from '../src/adversarial-river.mjs';

assert(RIVER_TEMPLATES.length>=6);

const k3=generateRiverScenario({seed:77,template:RIVER_TEMPLATES[0],archetype:'BALANCED_REG',depthBb:40,sizePct:100});
assert.equal(k3.templateId,'HEART_FLUSH_COMPLETES_K3');
assert.equal(k3.completion.flushCompleted,true);
assert.equal(k3.blocker.highFlushBlocker,false);
assert.equal(k3.rangeStatus,'lab-only');
assert.equal(k3.aggressionGate.allowed,false);
assert(['CALL','FOLD'].includes(k3.callAudit.action));
assert(Number.isFinite(k3.callAudit.equity));
assert(Number.isFinite(k3.callAudit.callEv));

const a=runRiverStressSuite({samples:2000,seed:424242});
assert.equal(a.samples,2000);
assert.equal(a.invalid,0);
assert.equal(a.calls+a.folds,2000);
assert(a.calls>0);
assert(a.folds>0);
assert.equal(a.blockedAggression,2000); // lab-only ranges can never authorize a raise override.
assert(a.regret.decisions===2000);
assert(a.regret.totalRegretBB>0);
assert(a.regret.materialRate>0);
assert(Number.isFinite(a.minEdge));
assert(Number.isFinite(a.maxEdge));
assert(a.minEdge<a.maxEdge);

// Same seed must reproduce the same suite summary and leading scenarios.
const b=runRiverStressSuite({samples:2000,seed:424242});
for(const key of ['calls','folds','blockedAggression','invalid','minEdge','maxEdge']) assert.equal(a[key],b[key]);
assert.deepEqual(
  a.rows.slice(0,25).map(x=>[x.seed,x.templateId,x.archetype,x.depthBb,x.sizePct,x.callAudit?.action]),
  b.rows.slice(0,25).map(x=>[x.seed,x.templateId,x.archetype,x.depthBb,x.sizePct,x.callAudit?.action])
);

// Different seed should alter at least one generated path.
const c=runRiverStressSuite({samples:50,seed:424243});
assert.notDeepEqual(
  a.rows.slice(0,20).map(x=>[x.templateId,x.archetype,x.depthBb,x.sizePct]),
  c.rows.slice(0,20).map(x=>[x.templateId,x.archetype,x.depthBb,x.sizePct])
);

console.log('PASS — Cash Pro Lab V0.4 adversarial river stress: 2000 deterministic spots');

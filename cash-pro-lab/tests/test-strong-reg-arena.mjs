import assert from 'node:assert/strict';
import {runLearningArena,runRiverArena,runStrongRegArena} from '../src/strong-reg-arena.mjs';

const regs=['BALANCED_REG','TIGHT_REG','AGGRO_REG','LAG_REG','TRICKY_REG'];

const learning=runLearningArena({archetypes:regs,handsPerProfile:300,seeds:4,seed:12345});
assert.equal(learning.profiles,5);
assert.equal(learning.totalRuns,20);
assert(learning.meanAbsError>=0 && learning.meanAbsError<0.08);
assert(learning.worstAbsError<0.16);
for(const id of regs){
  assert.equal(learning.byArchetype[id].samples,4);
  assert(learning.byArchetype[id].meanAbsError>=0);
}

const depths=[20,40,100,200];
const river=runRiverArena({archetypes:['BALANCED_REG','AGGRO_REG'],depths,samplesPerCell:12,seed:777});
assert.equal(river.cells.length,8);
assert.equal(river.totalSamples,96);
assert.equal(river.totalInvalid,0);
assert(river.totalBlocked>0);
for(const c of river.cells){
  assert(['BALANCED_REG','AGGRO_REG'].includes(c.archetype));
  assert(depths.includes(c.depthBb));
  assert.equal(c.valid+c.invalid,c.samples);
  assert.equal(c.regret.decisions,c.valid);
}

const again=runRiverArena({archetypes:['BALANCED_REG','AGGRO_REG'],depths,samplesPerCell:12,seed:777});
assert.deepEqual(river,again,'arena must be deterministic for the same seed');

const full=runStrongRegArena({
  learning:{archetypes:['BALANCED_REG','AGGRO_REG'],handsPerProfile:300,seeds:3,seed:998},
  river:{archetypes:['BALANCED_REG','AGGRO_REG'],depths:[20,50,100,200],samplesPerCell:10,seed:998}
});
assert.equal(full.mode,'OFFLINE_REPLAY_STUDY_ONLY');
assert.equal(full.gates.fieldCertified,false);
assert.equal(full.gates.deterministicCoverage,true);
assert.equal(full.gates.allDepthsCovered,true);
assert.equal(full.pass,true);

console.log('PASS — Cash Pro Lab V0.8 strong-reg arena regressions', JSON.stringify({
  learningMeanError:learning.meanAbsError,
  learningWorstError:learning.worstAbsError,
  riverSamples:river.totalSamples,
  blockedAggression:river.totalBlocked,
  regretBB:river.regret.totalRegretBB
}));

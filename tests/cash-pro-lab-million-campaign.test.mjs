import assert from 'node:assert/strict';
import test from 'node:test';
import { createMillionStudyManifest, auditMillionCampaignEnumeration } from '../src/cash-pro-lab/million-study-campaign.js';

test('default million campaign plans 3,139,200 strategically valid curriculum tickets',()=>{
  const manifest=createMillionStudyManifest();
  assert.equal(manifest.valid,true);
  assert.equal(manifest.curriculum.cells,439200);
  assert.equal(manifest.curriculum.tickets,3139200);
  assert.equal(manifest.curriculum.lanes.preflop.tickets,720000);
  assert.equal(manifest.curriculum.lanes['postflop-heads-up'].tickets,1382400);
  assert.equal(manifest.curriculum.lanes['postflop-multiway'].tickets,1036800);
  assert.equal(manifest.rules.preflopHasNoBoardTextureAxis,true);
  assert.equal(manifest.rules.holdoutMayInfluencePolicy,false);
  assert.equal(manifest.rules.holdoutMayTuneThresholds,false);
  assert.equal(manifest.rules.autoPromote,false);
  assert.match(manifest.honestClaim,/zero are counted as completed studies/i);
});

test('all 3,139,200 strategic tickets enumerate deterministically with continuous ordinals and isolated lanes',()=>{
  const first=auditMillionCampaignEnumeration();
  assert.equal(first.valid,true);
  assert.equal(first.ticketsEnumerated,3139200);
  assert.equal(first.strategicCellsEnumerated,439200);
  assert.equal(first.ordinalErrors,0);
  assert.equal(first.teacherLanes.preflop,720000);
  assert.equal(first.teacherLanes['postflop-heads-up'],1382400);
  assert.equal(first.teacherLanes['postflop-multiway'],1036800);
  assert.equal(first.splits.train+first.splits.dev+first.splits.holdout,first.ticketsEnumerated);
  assert.ok(first.splits.train>first.splits.dev*7);
  assert.ok(first.splits.train>first.splits.holdout*7);

  const second=auditMillionCampaignEnumeration();
  assert.equal(second.valid,true);
  assert.equal(second.checksum,first.checksum);
  assert.deepEqual(second.splits,first.splits);
  assert.deepEqual(second.teacherLanes,first.teacherLanes);
});

test('campaign refuses to call a reduced toy strategic curriculum million-scale',()=>{
  const manifest=createMillionStudyManifest({
    plans:{
      preflop:{axes:{effectiveStackBB:[100],heroPosition:['BTN'],activePlayers:[2],facingClass:['unopened']},samplesPerCell:1},
      'postflop-heads-up':{axes:{effectiveStackBB:[100],street:['river'],positionMatchup:['BTN-vs-BB'],potType:['srp'],initiative:['hero'],facingClass:['bet-large'],textureClass:['dry']},samplesPerCell:1},
      'postflop-multiway':{axes:{effectiveStackBB:[100],street:['river'],heroPosition:['BTN'],activePlayers:[3],potType:['srp'],initiative:['hero'],facingClass:['bet-large'],textureClass:['dry']},samplesPerCell:1},
    },
  });
  assert.equal(manifest.valid,false);
  assert.ok(manifest.errors.includes('campaign_below_million_scale_floor'));
});

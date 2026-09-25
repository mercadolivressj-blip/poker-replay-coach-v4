import assert from 'node:assert/strict';
import test from 'node:test';
import { createMillionStudyManifest, auditMillionCampaignEnumeration } from '../src/cash-pro-lab/million-study-campaign.js';

test('default million campaign plans more than three million honest curriculum tickets',()=>{
  const manifest=createMillionStudyManifest();
  assert.equal(manifest.valid,true);
  assert.equal(manifest.curriculum.cells,829440);
  assert.equal(manifest.curriculum.tickets,3317760);
  assert.equal(manifest.curriculum.teacherLanes.unsupported.tickets,0);
  assert.equal(manifest.rules.holdoutMayInfluencePolicy,false);
  assert.equal(manifest.rules.holdoutMayTuneThresholds,false);
  assert.equal(manifest.rules.autoPromote,false);
  assert.match(manifest.honestClaim,/zero are counted as completed studies/i);
});

test('all 3,317,760 tickets enumerate deterministically with continuous ordinals and isolated teacher lanes',()=>{
  const first=auditMillionCampaignEnumeration();
  assert.equal(first.valid,true);
  assert.equal(first.ticketsEnumerated,3317760);
  assert.equal(first.strategicCellsEnumerated,829440);
  assert.equal(first.ordinalErrors,0);
  assert.equal(first.teacherLanes.unsupported,0);
  assert.equal(first.splits.train+first.splits.dev+first.splits.holdout,first.ticketsEnumerated);
  assert.ok(first.splits.train>first.splits.dev*7);
  assert.ok(first.splits.train>first.splits.holdout*7);

  const second=auditMillionCampaignEnumeration();
  assert.equal(second.valid,true);
  assert.equal(second.checksum,first.checksum);
  assert.deepEqual(second.splits,first.splits);
  assert.deepEqual(second.teacherLanes,first.teacherLanes);
});

test('campaign refuses to call a reduced toy curriculum million-scale',()=>{
  const manifest=createMillionStudyManifest({
    axes:{
      effectiveStackBB:[100],heroPosition:['BTN'],street:['river'],activePlayers:[2],
      potClass:['medium'],facingClass:['bet-large'],initiative:['villain'],textureClass:['dry'],
    },
    samplesPerCell:4,
  });
  assert.equal(manifest.valid,false);
  assert.ok(manifest.errors.includes('campaign_below_million_scale_floor'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { strategicCurriculumManifest, iterateStrategicCurriculum, strategicSplitGroupKey } from '../src/cash-pro-lab/strategic-curriculum.js';

test('strategic curriculum plans more than three million semantically partitioned tickets',()=>{
  const manifest=strategicCurriculumManifest();
  assert.equal(manifest.lanes.preflop.cells,1440);
  assert.equal(manifest.lanes.preflop.tickets,720000);
  assert.equal(manifest.lanes['postflop-heads-up'].cells,230400);
  assert.equal(manifest.lanes['postflop-heads-up'].tickets,1382400);
  assert.equal(manifest.lanes['postflop-multiway'].cells,207360);
  assert.equal(manifest.lanes['postflop-multiway'].tickets,1036800);
  assert.equal(manifest.cells,439200);
  assert.equal(manifest.tickets,3139200);
  assert.equal(manifest.splitUnit,'strategic-root-family');
  assert.ok(manifest.invariants.some(x=>/preflop has no board texture/i.test(x)));
  assert.ok(manifest.invariants.some(x=>/never cross train dev holdout/i.test(x)));
});

test('preflop strategic tickets never carry board texture or postflop pot-type axes',()=>{
  const rows=[...iterateStrategicCurriculum({
    lanes:['preflop'],
    plans:{preflop:{samplesPerCell:1,axes:{effectiveStackBB:[100],heroPosition:['BTN'],activePlayers:[2],facingClass:['unopened']}}},
  })];
  assert.equal(rows.length,1);
  assert.equal(rows[0].lane,'preflop');
  assert.equal(rows[0].axes.textureClass,undefined);
  assert.equal(rows[0].axes.potType,undefined);
});

test('heads-up strategic tickets use ordered matchup and never activePlayers axis',()=>{
  const rows=[...iterateStrategicCurriculum({
    lanes:['postflop-heads-up'],
    plans:{'postflop-heads-up':{samplesPerCell:1,axes:{effectiveStackBB:[100],street:['river'],positionMatchup:['BB-vs-BTN'],potType:['srp'],initiative:['villain'],facingClass:['bet-large'],textureClass:['dynamic']}}},
  })];
  assert.equal(rows.length,1);
  assert.equal(rows[0].axes.positionMatchup,'BB-vs-BTN');
  assert.equal(rows[0].axes.activePlayers,undefined);
  assert.ok(rows[0].splitGroupId);
});

test('same heads-up solver root family keeps street action branch and hero perspective in one split',()=>{
  const rows=[...iterateStrategicCurriculum({
    seed:'root-isolation',lanes:['postflop-heads-up'],
    plans:{'postflop-heads-up':{
      samplesPerCell:1,
      axes:{
        effectiveStackBB:[100],
        street:['flop','turn','river'],
        positionMatchup:['BB-vs-BTN','BTN-vs-BB'],
        potType:['srp'],
        initiative:['hero','villain','neutral'],
        facingClass:['check','bet-large','raise'],
        textureClass:['two-tone'],
      },
    }},
  })];
  assert.equal(rows.length,54);
  assert.equal(new Set(rows.map(r=>r.split)).size,1);
  assert.equal(new Set(rows.map(r=>r.splitGroupId)).size,1);
  const keys=new Set(rows.map(r=>strategicSplitGroupKey(r.lane,r.axes,r.sampleIndex)));
  assert.equal(keys.size,1);
});

test('same multiway root family keeps later streets and facing branches in one split',()=>{
  const rows=[...iterateStrategicCurriculum({
    seed:'mw-root-isolation',lanes:['postflop-multiway'],
    plans:{'postflop-multiway':{
      samplesPerCell:1,
      axes:{
        effectiveStackBB:[50],street:['flop','turn','river'],heroPosition:['CO'],activePlayers:[3],potType:['srp'],
        initiative:['hero','villain','neutral'],facingClass:['check','bet-medium','raise'],textureClass:['dynamic'],
      },
    }},
  })];
  assert.equal(rows.length,27);
  assert.equal(new Set(rows.map(r=>r.split)).size,1);
  assert.equal(new Set(rows.map(r=>r.splitGroupId)).size,1);
});

test('multiway strategic lane begins at three active players in default manifest',()=>{
  const manifest=strategicCurriculumManifest();
  assert.deepEqual(manifest.lanes['postflop-multiway'].axes.activePlayers,[3,4,5,6]);
});

test('strategic ticket generation is deterministic for the same seed',()=>{
  const options={
    seed:'same-seed',lanes:['preflop'],
    plans:{preflop:{samplesPerCell:2,axes:{effectiveStackBB:[50],heroPosition:['CO'],activePlayers:[6],facingClass:['vs-open']}}},
  };
  assert.deepEqual([...iterateStrategicCurriculum(options)],[...iterateStrategicCurriculum(options)]);
});

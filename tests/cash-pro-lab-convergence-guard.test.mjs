import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { assessProbeCurve, parseNashConvCheckpoint } from '../src/cash-pro-lab/probe-convergence-guard.js';

test('safe probe script parses before it can reach the VM',()=>{
  const r=spawnSync(process.execPath,['--check','scripts/cash-pro-lab-safe-probe.mjs'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr||r.stdout);
});

test('parses a measured NashConv checkpoint',()=>{
  assert.deepEqual(
    parseNashConvCheckpoint('iter      200  NashConv 0.116584 chips  2.1197% of pot  [measured]'),
    {iterations:200,chips:0.116584,pct:2.1197},
  );
  assert.equal(parseNashConvCheckpoint('iter 100 exploitability -0.22 chips -4.0% of pot'),null);
});

test('target checkpoint becomes ready and stops',()=>{
  const r=assessProbeCurve([
    {iterations:50,chips:0.5,pct:9},
    {iterations:100,chips:0.2,pct:2},
    {iterations:150,chips:0.02,pct:0.2},
  ],{targetPct:0.25});
  assert.equal(r.status,'TARGET_REACHED');
  assert.equal(r.stop,true);
  assert.equal(r.ready,true);
});

test('small oscillations do not cause a false divergence abort',()=>{
  const r=assessProbeCurve([
    {iterations:50,chips:0.4,pct:4.0},
    {iterations:100,chips:0.2,pct:2.0},
    {iterations:150,chips:0.21,pct:2.1},
    {iterations:200,chips:0.19,pct:1.9},
    {iterations:250,chips:0.195,pct:1.95},
  ],{targetPct:0.25});
  assert.equal(r.status,'RUNNING');
  assert.equal(r.stop,false);
});

test('hard explosion aborts instead of burning a long run',()=>{
  const r=assessProbeCurve([
    {iterations:50,chips:0.5,pct:8.0},
    {iterations:100,chips:0.2,pct:3.0},
    {iterations:150,chips:0.1,pct:1.5},
    {iterations:200,chips:0.4,pct:5.0},
  ],{targetPct:0.25});
  assert.equal(r.status,'DIVERGED');
  assert.equal(r.stop,true);
  assert.equal(r.ready,false);
  assert.equal(r.reason,'hard_nashconv_explosion');
});

test('sustained regression aborts after three worsening checkpoints',()=>{
  const r=assessProbeCurve([
    {iterations:50,chips:0.5,pct:5.0},
    {iterations:100,chips:0.2,pct:2.0},
    {iterations:150,chips:0.22,pct:2.2},
    {iterations:200,chips:0.26,pct:2.6},
    {iterations:250,chips:0.31,pct:3.1},
  ],{targetPct:0.25});
  assert.equal(r.status,'DIVERGED');
  assert.equal(r.stop,true);
  assert.equal(r.reason,'sustained_nashconv_regression');
});

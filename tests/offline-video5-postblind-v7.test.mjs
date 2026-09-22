import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const summary = JSON.parse(fs.readFileSync(new URL('../standalone-lab/calibration/session-2026-09-21-video5-postblind-v7-summary.json', import.meta.url)));

test('video5 keeps blind/post-blind methodology explicit', () => {
  assert.equal(summary.readerHead, 'cdecb04b6230a343535fcca5129a14a5579ea44f');
  assert.equal(summary.methodology.firstBlindPreserved, true);
  assert.equal(summary.methodology.firstBlindWasPerfect, false);
  assert.equal(summary.methodology.v7IsPostBlind, true);
  assert.equal(summary.methodology.visualReaderChangedAfterBlind, false);
  assert.equal(summary.methodology.ledgerHarnessChangedAfterBlind, true);
  assert.match(summary.calibrationPolicy, /sessions 1-2 frozen only/i);
});

test('video5 post-blind v7 closes the complete conservative gate', () => {
  const v = summary.v7;
  assert.equal(v.handsDetected, 17);
  assert.equal(v.heroDecisionsDetected, 37);
  for (const key of [
    'buttonsConfirmed', 'heroCardsComplete', 'boardComplete', 'heroStackComplete',
    'potComplete', 'toCallComplete', 'positionComplete', 'historyComplete',
    'brainValidDecisions', 'heroActionAfterDecision',
  ]) assert.equal(v[key], 37, key);
  assert.equal(v.handContinuity, '17/17');
  assert.deepEqual(v.blockReasons, {});
  assert.equal(v.criticalInternalInconsistencies, 0);
  assert.equal(v.semanticErrors, 0);
  assert.equal(v.badDecisions, 0);
});

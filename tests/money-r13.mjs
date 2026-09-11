import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parseNumberText } from '../src/core/ocr.js';
import { PotConsensus } from '../src/detectors/pot.js';
import { HandMachine } from '../src/core/state-machine.js';
import { normalizeAmount, formatAmount } from '../src/vision/money-runtime-r13.js';

assert.equal(parseNumberText('US$ 0,07'), 0.07);
assert.equal(parseNumberText('US$ 0,04'), 0.04);
assert.equal(parseNumberText('US$ 1,50'), 1.5);
assert.equal(parseNumberText('1.000'), 1000);
assert.equal(parseNumberText('14.884'), 14884);
assert.equal(parseNumberText('Pote: US$ 0,07'), 0.07);

assert.equal(normalizeAmount(0.07), 0.07);
assert.equal(formatAmount(0.07), '0,07');
assert.equal(formatAmount(1.5), '1,50');
assert.equal(formatAmount(700), '700');
assert.equal(formatAmount(2800), '2.800');

const consensus = new PotConsensus();
assert.equal(consensus.observe(0.07), null);
assert.equal(consensus.observe(0.07), 0.07);
assert.equal(consensus.value, 0.07);

const machine = new HandMachine();
assert.equal(machine.setPot(0.07, machine.handId), true);
assert.equal(machine.state.pot, 0.07);
machine.state.startedAt = performance.now() - 1000;
machine.state.pot = 0.11;
const now = performance.now();
assert.equal(machine.observePotValue(0.03, now).newHand, false);
assert.equal(machine.observePotValue(0.03, now + 20).newHand, true);

const boot = fs.readFileSync(new URL('../src/bootstrap-r13.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../r13.html', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../src/vision/money-runtime-r13.js', import.meta.url), 'utf8');
assert.match(boot, /money-runtime-r13\.js/);
assert.match(boot, /hero-authority-runtime-r11\.js/);
assert.match(html, /V4 STANDALONE · R13/);
assert.match(runtime, /PotConsensus\.prototype\.observe/);
assert.match(runtime, /HandMachine\.prototype\.setPot/);
assert.match(runtime, /US\$ 0,07|formatAmount/);

console.log('MONEY R13 regressions passed');

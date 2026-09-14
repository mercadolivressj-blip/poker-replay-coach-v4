import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../src/vision/hero-authority-runtime-r11.js', import.meta.url), 'utf8');
const boot = fs.readFileSync(new URL('../src/bootstrap-r12.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../r12.html', import.meta.url), 'utf8');

assert.match(src, /function onHandId\(machine\)/);
assert.match(src, /latch\.handId = machine\.handId/);
assert.match(src, /confirmed visual cards survive bookkeeping churn/);
assert.match(src, /if \(latch\?\.cards\?\.length === 2\)/);
assert.match(src, /if \(sameGeneration\)/);
assert.match(src, /if \(heroEl\) heroEl\.textContent = label\(latch\.cards\)/);
assert.match(src, /absentFrames >= 4/);
assert.match(src, /now - absentSince >= 140/);
assert.match(src, /gapArmed = true/);
const onHandId = src.match(/function onHandId\(machine\)[\s\S]*?\n\}/)?.[0] || '';
assert.doesNotMatch(onHandId, /latch = null/);
assert.doesNotMatch(onHandId, /latchFp = null/);
assert.match(boot, /hero-authority-runtime-r11\.js/);
assert.match(html, /V4 STANDALONE · R12/);

console.log('HERO LATCH R12 passed');

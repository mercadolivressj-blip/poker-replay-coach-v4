import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PokerStarsCommitmentReader } from '../src/core/pokerstars-numeric-reader.js';

const bank = JSON.parse(await readFile(new URL('../src/core/pokerstars-commitment-bank.json', import.meta.url), 'utf8'));
const reader = new PokerStarsCommitmentReader(bank);
assert.equal(Object.keys(bank.digits).length, 10);
for (const digit of Object.keys(bank.digits)) assert.ok(bank.digits[digit].length > 0, `digit ${digit} missing`);
for (const profile of ['commitment', 'stack', 'pot']) {
  assert.equal(Object.keys(bank.profiles[profile].digits).length, 10);
  for (const digit of Object.keys(bank.profiles[profile].digits)) assert.ok(bank.profiles[profile].digits[digit].length > 0, `${profile} digit ${digit} missing`);
}

const rgba = (width, height) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { data, width, height };
};
const empty = reader.readImageData(rgba(220, 80));
assert.equal(empty.value, null);
assert.equal(empty.visible, false);
for (const profile of ['stack', 'pot']) {
  const result = reader.readMoneyImageData(rgba(profile === 'stack' ? 85 : 70, profile === 'stack' ? 26 : 25), profile);
  assert.equal(result.value, null);
  assert.equal(result.visible, false);
}
console.log('pokerstars-numeric-reader ok');

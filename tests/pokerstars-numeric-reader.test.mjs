import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from '/workspace/scratch/c4c088db694b/repo/node_modules/sharp/lib/index.js';
import { PokerStarsCommitmentReader } from '../src/core/pokerstars-numeric-reader.js';

const bank = JSON.parse(await readFile(new URL('../src/core/pokerstars-commitment-bank.json', import.meta.url), 'utf8'));
const reader = new PokerStarsCommitmentReader(bank);
assert.equal(Object.keys(bank.digits).length, 10);
for (const digit of Object.keys(bank.digits)) assert.ok(bank.digits[digit].length > 0, `digit ${digit} missing`);

const image = await sharp({
  create: { width: 220, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
}).png().toBuffer();
const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
const empty = reader.readImageData({ data, width: info.width, height: info.height });
assert.equal(empty.value, null);
assert.equal(empty.visible, false);
console.log('pokerstars-numeric-reader ok');

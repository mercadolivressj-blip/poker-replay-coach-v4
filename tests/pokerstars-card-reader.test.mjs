import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PokerStarsCardReader } from '../src/core/pokerstars-card-reader.js';

const bank = JSON.parse(await readFile(new URL('../src/core/pokerstars-card-bank.json', import.meta.url), 'utf8'));
assert.equal(bank.version, 'pokerstars-card-glyphs-v11-v1');
assert.deepEqual(Object.keys(bank.board.ranks).sort(), '23456789AJKQT'.split('').sort());
assert.deepEqual(Object.keys(bank.board.suits).sort(), ['c', 'd', 'h', 's']);

const data = new Uint8ClampedArray(60 * 85 * 4);
for (let i = 3; i < data.length; i += 4) data[i] = 255;
const result = new PokerStarsCardReader(bank, 'board').readImageData({ data, width: 60, height: 85 });
assert.equal(result.card, null);
console.log('pokerstars-card-reader ok');

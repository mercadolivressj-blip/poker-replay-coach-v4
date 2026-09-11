import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HandMachine } from '../src/core/state-machine.js';
import { classifySuitPixels, SUIT_MASK_W, SUIT_MASK_H } from '../src/core/suit-classifier.js';

// Board lifecycle must be independent from Hero visibility. Once a flop slot is
// confirmed it cannot flicker to another rank/suit inside the same hand.
const m = new HandMachine();
m.newHand('spectator-hand', 1000);
const handId = m.handId;
const flop = [
  { rank: '3', suit: 'clubs', confidence: .92, suitConfidence: .91 },
  { rank: '2', suit: 'spades', confidence: .93, suitConfidence: .92 },
  { rank: '6', suit: 'diamonds', confidence: .94, suitConfidence: .93 },
];
assert.equal(m.setBoard(flop, handId), true);
assert.equal(m.state.street, 'flop');
assert.deepEqual(m.state.board.map((c) => `${c.rank}:${c.suit}`), ['3:clubs','2:spades','6:diamonds']);

const flicker = [
  { rank: '5', suit: 'clubs', confidence: .99, suitConfidence: .99 },
  { rank: '2', suit: 'spades', confidence: .99, suitConfidence: .99 },
  { rank: '6', suit: 'diamonds', confidence: .99, suitConfidence: .99 },
];
assert.equal(m.setBoard(flicker, handId), true);
assert.equal(m.state.board[0].rank, '3', 'confirmed flop rank must not flicker 3→5');
assert.equal(m.setBoardOccupancy(0, handId), true);
assert.equal(m.state.board.length, 3, 'temporary zero occupancy must not erase a confirmed flop');
assert.equal(m.state.street, 'flop');

const turn = [...flop, { rank: '4', suit: 'hearts', confidence: .92, suitConfidence: .9 }];
assert.equal(m.setBoard(turn, handId), true);
assert.equal(m.state.street, 'turn');
assert.deepEqual(m.state.board.map((c) => c.rank), ['3','2','6','4']);
assert.equal(m.setBoard([...flop, { rank: '4', suit: 'diamonds', confidence: .99, suitConfidence: .99 }], handId), true);
assert.equal(m.state.board[3].suit, 'hearts', 'confirmed turn suit must remain sticky');

m.newHand('board-reset', 2000);
assert.equal(m.state.board.length, 0, 'real new hand still clears board');
assert.equal(m.setBoard([
  { rank: '8', suit: 'spades', confidence: .9 },
  { rank: '8', suit: 'clubs', confidence: .9 },
  { rank: 'K', suit: 'hearts', confidence: .9 },
], m.handId), true);
assert.deepEqual(m.state.board.map((c) => c.rank), ['8','8','K']);

// Face-pair suit regression. PokerStars face cards can put the tiny authoritative
// suit immediately right of Q while the illustrated face sits farther right.
function unpack(b64) {
  const bytes = Buffer.from(b64, 'base64');
  const out = new Uint8Array(SUIT_MASK_W * SUIT_MASK_H);
  for (let i = 0; i < out.length; i++) out[i] = bytes[i >> 3] & (1 << (i & 7)) ? 1 : 0;
  return out;
}
const MASKS = {
  spades: ['black', 'AAAAAAAAAAQAAAQAAB8AwH8AwH8A4P8B4P8B4P8D+P8D+P8D+P8P+P8P+P8P+P8D+P8D4OQB4OQBAAQAAB8AAB8AAAAAAAAA'],
  clubs: ['black', 'AAAAAAAAAAQAAAQAAB8AwB8AwB8AAB8AAB8AABwA+P8D+P8D+P8P+P8P+P8P+OQD+OQDAAQAAAQAAAQAAB8AAB8AAAAAAAAA'],
  hearts: ['red', 'AAAAAAAAwIcPwIcP8P8/8P8//P8//P8//P8/8P8/8P8/8P8/8P8/wP8PwP8PgP8DgP8DgP8BAH4AAH4AABgAABgAAAAAAAAA'],
};
function blankCard() {
  const w = 112, h = 88; const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 24; data[i + 1] = 105; data[i + 2] = 58; data[i + 3] = 255; }
  const card = { x: 14, y: 8, w: 84, h: 68 };
  for (let y = card.y; y < card.y + card.h; y++) for (let x = card.x; x < card.x + card.w; x++) {
    const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 246; data[i + 3] = 255;
  }
  return { data, w, h, card };
}
function drawMask(f, mask, family, ox, oy, size = 15) {
  const rgb = family === 'red' ? [205,28,34] : [24,24,24];
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
    const sx = Math.min(SUIT_MASK_W - 1, Math.floor(dx * SUIT_MASK_W / size));
    const sy = Math.min(SUIT_MASK_H - 1, Math.floor(dy * SUIT_MASK_H / size));
    if (!mask[sy * SUIT_MASK_W + sx]) continue;
    const x = f.card.x + ox + dx, y = f.card.y + oy + dy; const i = (y * f.w + x) * 4;
    f.data[i] = rgb[0]; f.data[i + 1] = rgb[1]; f.data[i + 2] = rgb[2]; f.data[i + 3] = 255;
  }
}
function drawRankQ(f) {
  for (let y = f.card.y + 4; y < f.card.y + 25; y++) for (let x = f.card.x + 4; x < f.card.x + 18; x++) {
    if (x === f.card.x + 4 || x === f.card.x + 17 || y === f.card.y + 4 || y === f.card.y + 24) {
      const i = (y * f.w + x) * 4; f.data[i] = f.data[i + 1] = f.data[i + 2] = 22;
    }
  }
}
function faceSideFixture(suit) {
  const f = blankCard(); drawRankQ(f);
  const [family, b64] = MASKS[suit];
  drawMask(f, unpack(b64), family, 20, 7, 15);
  drawMask(f, unpack(MASKS.hearts[1]), 'red', 52, 12, 23);
  return f;
}
for (const suit of ['spades','clubs']) {
  const f = faceSideFixture(suit);
  const out = classifySuitPixels(f.data, f.w, f.h, 'Q');
  assert.equal(out.suit || out.candidate, suit, `Q ${suit} must preserve the side-glyph candidate for temporal consensus`);
  assert(['face-side-glyph','corner-under-rank'].includes(out.roi));
}

// Runtime contracts for this sprint.
const tableObserver = fs.readFileSync(new URL('../src/vision/table-observer.js', import.meta.url), 'utf8');
assert.doesNotMatch(tableObserver, /!this\.accessToken/, 'preview table observer must be allowed to auto-probe visual state');
assert.match(tableObserver, /minIntervalMs = 1350/);
const bootstrap = fs.readFileSync(new URL('../src/bootstrap.js', import.meta.url), 'utf8');
assert.doesNotMatch(bootstrap, /local-action-runtime/, 'Dealer chat OCR must stay off the replay hot path');
const api = fs.readFileSync(new URL('../api/table-state.js', import.meta.url), 'utf8');
assert.match(api, /Pago\/Paga\/Pagou/);
assert.match(api, /committed is crucial/);
assert.match(api, /NEVER renumber occupied seats/);

console.log('REPLAY STATE STABILITY V1 regressions passed');

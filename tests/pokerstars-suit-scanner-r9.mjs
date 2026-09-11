import assert from 'node:assert/strict';
import {
  classifyPokerStarsSuitMask,
  classifyPokerStarsSuitPixels,
  POKERSTARS_SUIT_MASK_W,
  POKERSTARS_SUIT_MASK_H,
  POKERSTARS_SUIT_TEMPLATE_BANK,
} from '../src/core/pokerstars-suit-scanner.js';
import { unpackMask } from '../src/core/rank-mask.js';

function decodeBase64(s) {
  return Uint8Array.from(Buffer.from(s, 'base64'));
}

const family = (suit) => ['hearts', 'diamonds'].includes(suit) ? 'red' : 'black';

// The bank itself is generated from real PokerStars replay corner glyphs.
for (const [suit, rows] of Object.entries(POKERSTARS_SUIT_TEMPLATE_BANK)) {
  assert(rows.length >= 1, `${suit} needs at least one real replay exemplar`);
  for (const row of rows) {
    const mask = unpackMask(decodeBase64(row), POKERSTARS_SUIT_MASK_W * POKERSTARS_SUIT_MASK_H);
    const out = classifyPokerStarsSuitMask(mask, family(suit));
    assert.equal(out.suit, suit, `${suit} real replay glyph must classify exactly`);
    assert(out.confidence >= 0.88, `${suit} should be a strong direct template match`);
  }
}

function blankCard(w = 90, h = 110) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 246;
    data[i * 4 + 1] = 246;
    data[i * 4 + 2] = 246;
    data[i * 4 + 3] = 255;
  }
  return { data, w, h };
}

function paintTemplate(card, b64, suit, { x = 7, y = 56, scale = 0.72 } = {}) {
  const mask = unpackMask(decodeBase64(b64), POKERSTARS_SUIT_MASK_W * POKERSTARS_SUIT_MASK_H);
  const red = family(suit) === 'red';
  for (let my = 0; my < POKERSTARS_SUIT_MASK_H; my++) {
    for (let mx = 0; mx < POKERSTARS_SUIT_MASK_W; mx++) {
      if (!mask[my * POKERSTARS_SUIT_MASK_W + mx]) continue;
      const x0 = Math.round(x + mx * scale);
      const y0 = Math.round(y + my * scale);
      const x1 = Math.max(x0 + 1, Math.round(x + (mx + 1) * scale));
      const y1 = Math.max(y0 + 1, Math.round(y + (my + 1) * scale));
      for (let py = y0; py < y1 && py < card.h; py++) {
        for (let px = x0; px < x1 && px < card.w; px++) {
          const i = (py * card.w + px) * 4;
          if (red) {
            card.data[i] = 220; card.data[i + 1] = 20; card.data[i + 2] = 28;
          } else {
            card.data[i] = 22; card.data[i + 1] = 22; card.data[i + 2] = 22;
          }
        }
      }
    }
  }
}

// Geometry regression: the fixed corner scanner must work independently of rank
// and centre pips/face art. We paint only the corner glyph into a realistic card.
for (const suit of ['clubs', 'spades', 'hearts', 'diamonds']) {
  for (const scale of [0.62, 0.72, 0.82]) {
    const card = blankCard();
    paintTemplate(card, POKERSTARS_SUIT_TEMPLATE_BANK[suit][0], suit, { scale });
    const out = classifyPokerStarsSuitPixels(card.data, card.w, card.h, 'A');
    assert.equal(out.suit, suit, `${suit} should survive ${scale.toFixed(2)}x corner scale`);
    assert.match(out.scanner || '', /pokerstars-corner/);
  }
}

// Family split is deliberately deterministic before shape comparison.
{
  const clubsMask = unpackMask(decodeBase64(POKERSTARS_SUIT_TEMPLATE_BANK.clubs[0]), 24 * 24);
  const heartsMask = unpackMask(decodeBase64(POKERSTARS_SUIT_TEMPLATE_BANK.hearts[0]), 24 * 24);
  assert.equal(classifyPokerStarsSuitMask(clubsMask, 'black').suit, 'clubs');
  assert.equal(classifyPokerStarsSuitMask(heartsMask, 'red').suit, 'hearts');
}

console.log('POKERSTARS SUIT SCANNER R9 regressions passed');

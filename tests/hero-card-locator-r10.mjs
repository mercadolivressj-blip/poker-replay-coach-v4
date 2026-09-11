import assert from 'node:assert/strict';
import { locateHeroPairRects } from '../src/detectors/hero-card-locator.js';

function synthetic(width, height, leftX, topY, cardW, cardH, gap = 3) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 0] = 26; data[i * 4 + 1] = 92; data[i * 4 + 2] = 39; data[i * 4 + 3] = 255;
  }
  function card(x, y, red = false) {
    for (let yy = y; yy < y + cardH; yy++) for (let xx = x; xx < x + cardW; xx++) {
      const i = (yy * width + xx) * 4;
      data[i] = 242; data[i+1] = 242; data[i+2] = 242;
    }
    // top-left rank/suit ink keeps the synthetic card realistic enough for presence logic.
    for (let yy = y + 4; yy < y + Math.max(8, Math.round(cardH * 0.45)); yy++) for (let xx = x + 4; xx < x + Math.max(8, Math.round(cardW * 0.28)); xx++) {
      if ((xx + yy) % 3 !== 0) continue;
      const i = (yy * width + xx) * 4;
      data[i] = red ? 190 : 20; data[i+1] = red ? 35 : 20; data[i+2] = red ? 35 : 20;
    }
  }
  card(leftX, topY, false);
  card(leftX + cardW + gap, topY, true);
  return data;
}

for (const cfg of [
  [460, 180, 175, 58, 44, 63, 2],
  [460, 180, 166, 61, 48, 58, 4],
  [380, 160, 142, 52, 38, 54, 1],
  [520, 210, 196, 71, 50, 68, 3],
]) {
  const [w,h,x,y,cw,ch,gap] = cfg;
  const pair = locateHeroPairRects(synthetic(w,h,x,y,cw,ch,gap), w, h);
  assert.ok(pair, `Hero pair should be found for ${JSON.stringify(cfg)}`);
  assert.equal(pair.length, 2);
  assert.ok(pair[0].x < pair[1].x);
  assert.ok(Math.abs(pair[0].y - pair[1].y) <= 3);
}

console.log('HERO CARD LOCATOR R10 regressions passed');

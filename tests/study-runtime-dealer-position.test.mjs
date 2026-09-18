import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../standalone-lab/study-runtime-public-v1.html',import.meta.url),'utf8');

test('public study runtime derives hero position from local dealer button',()=>{
  assert.match(html,/detectDealerButtonSeat/);
  assert.match(html,/positionsFromDealer/);
  assert.match(html,/function observeLocalDealer\(/);
  assert.match(html,/observeLocalDealer\(img,aw,ah,now\)/);
  assert.match(html,/posição derivada.*dealer local/);
  assert.match(html,/lockedDealerSeat/);
});

test('local dealer map has authority before metadata fallback',()=>{
  const fn=html.match(/function captureSeatMap\(\)\{[\s\S]*?\n\}/)?.[0]||'';
  assert.match(fn,/if\(lockedDealerSeat\).*positionsFromDealer/);
  assert.match(fn,/const heroPos=state\.heroPosition\|\|lockedPosition/);
  assert.ok(fn.indexOf('lockedDealerSeat')<fn.indexOf('state.heroPosition'),'dealer-derived mapping must be tried before metadata position');
});

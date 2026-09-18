import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const html=fs.readFileSync(fileURLToPath(new URL('../standalone-lab/study-runtime-public-v1.html',import.meta.url)),'utf8');

assert.match(html,/poker-brain-v4-public\.vercel\.app\/api\/brain/);
assert.doesNotMatch(html,/poker-brain-v1-preview\.vercel\.app\/api\/brain/);
assert.match(html,/POLICY V4 LIVE/);

assert.match(html,/function normalizeToCall\(\)/);
assert.match(html,/legal\.has\('CHECK'\).*state\.toCall=null/);
assert.match(html,/function coherentState\(\)/);
assert.match(html,/snapshot desalinhado/);
assert.match(html,/now-seen\[k\]>7000/);
assert.match(html,/spread>5500/);
assert.match(html,/state\.heroPresence!==\'present\'/);

assert.match(html,/heroAbsentStreak>=4/);
assert.match(html,/lastHeroConfirmedAt>6500/);
assert.match(html,/Hero\/mesa deixou de estar visível/);
assert.match(html,/function resetHand\(/);

assert.match(html,/function metaFrame\(\)\{return full\(1120,\.72\)\}/);
assert.match(html,/metaUrgent/);
assert.doesNotMatch(html,/lanes\.meta\.busy&&metaUrgent/);
assert.match(html,/Fallback manual/);
assert.match(html,/manualPos/);
assert.match(html,/manualNode/);
assert.match(html,/replay iniciado · metadata prioritária/);

console.log('public study runtime: freshness/hero-debounce/stale-clear/parallel-meta/manual-fallback/Policy V4 wiring OK');

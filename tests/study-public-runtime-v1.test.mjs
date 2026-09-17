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
assert.match(html,/now-seen\[k\]>5000/);

assert.match(html,/heroAbsentStreak>=2/);
assert.match(html,/Hero\/mesa deixou de estar visível/);
assert.match(html,/function resetHand\(/);

assert.match(html,/function metaFrame\(\)\{return full\(720,\.56\)\}/);
assert.match(html,/metaUrgent/);
assert.match(html,/lanes\.meta\.busy&&metaUrgent/);
assert.match(html,/replay iniciado · metadata prioritária/);

console.log('public study runtime: atomic freshness/reset/meta-priority/Policy V4 wiring OK');

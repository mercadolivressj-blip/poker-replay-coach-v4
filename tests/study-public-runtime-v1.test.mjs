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
assert.match(html,/now-t>7000/);
assert.match(html,/spread>5500/);
assert.match(html,/state\.heroPresence!==\'present\'/);

assert.match(html,/heroAbsentStreak>=4/);
assert.match(html,/lastHeroConfirmedAt>6500/);
assert.match(html,/Hero não está mais na mão/);
assert.match(html,/function resetHand\(/);
assert.match(html,/handEpoch/);
assert.match(html,/r\.epoch!==handEpoch/);
assert.match(html,/DROP .*resposta de mão antiga/);
assert.match(html,/function observeBlinds\(/);
assert.match(html,/blinds confirmados/);
assert.match(html,/function historyMerge\(/);
assert.match(html,/DROP history instável/);
assert.match(html,/function decisionPointFingerprint\(/);
assert.match(html,/function highImpactFacing\(/);
assert.match(html,/Spot de alto impacto/);
assert.match(html,/BRAIN QUORUM/);
assert.match(html,/BRAIN FIXADO/);
assert.match(html,/pinnedDecisionPoint/);
assert.match(html,/Pot reiniciou: nova mão detectada/);
assert.match(html,/board regressivo\/incompatível/);

assert.match(html,/function metaFrame\(\)\{return full\(1120,\.72\)\}/);
assert.match(html,/metaUrgent/);
assert.doesNotMatch(html,/lanes\.meta\.busy&&metaUrgent/);
assert.match(html,/Fallback manual/);
assert.match(html,/manualPos/);
assert.match(html,/manualNode/);
assert.match(html,/posição corrigida por CHECK pré-flop: BB/);
assert.match(html,/lockedPosition='BB'/);
assert.match(html,/replay iniciado · metadata prioritária/);

console.log('public study runtime: hand-epoch/frozen-metadata/monotonic-board/history/freshness/Policy V4 wiring OK');

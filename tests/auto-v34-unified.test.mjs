import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../standalone-lab/ssj-poker-auto-v34-unified.html', import.meta.url), 'utf8');

assert.match(html, /AUTO V34 UNIFIED/);
assert.match(html, /computeToCallFromCommitments/);
assert.match(html, /resolveSeatCommitmentV1/);
assert.match(html, /validatePokerSnapshot/);
assert.match(html, /toCallSource:'commitment-delta'/);
assert.match(html, /buttonsSource:'physical-action-buttons'/);
assert.match(html, /actionLedgerSource:'seat-state-ledger-v1'/);
assert.match(html, /void scanCommitments\(false\)/);
assert.match(html, /V11 · ESTADO BLOQUEADO/);
assert.match(html, /new URLSearchParams\(location\.search\)\.get\('replay'\)/);
assert.match(html, /window\.__SSJ_TEST=/);
assert.match(html, /latencyMs/);
assert.match(html, /video\.crossOrigin='anonymous'/);
assert.match(html, /ssj-test-telemetry/);
assert.match(html, /heroTurn&&commitReadyEpoch!==heroTurnEpoch/);
assert.match(html, /interval=numericReader\?120:900/);
assert.match(html, /cropRect\(band\.region,300\)/);
assert.match(html, /function commitmentBatchCanvas/);
assert.match(html, /function commitmentBatchParts/);
assert.match(html, /function commitmentBatchTsv/);
assert.match(html, /ocr\.readBatch\(batch/);
assert.match(html, /setTimeout\(\(\)=>scanCommitments\(true\),0\)/);
assert.match(html, /quiet<700/);
assert.match(html, /commitment-delta/);
assert.match(html, /DEFESA CONSERVADORA/);
assert.match(html, /betweenHands&&!heroTurn/);
assert.match(html, /PokerStarsCommitmentReader/);
assert.match(html, /numericReaderPromise/);
assert.match(html, /commitmentPixelCanvas/);
assert.match(html, /numericReaderMs/);
assert.match(html, /readMoneyCanvas/);
assert.match(html, /function observeLedger/);
assert.match(html, /turn-transition/);
assert.match(html, /card-disappearance/);
assert.match(html, /id="replay-file"/);

// V33 read the CALL amount from the physical button crop.  V34 may use the
// button only to establish legal actions; money must come from commitments.
assert.doesNotMatch(html, /capture\(\.655,\.935,\.19,\.05/);
assert.doesNotMatch(html, /toCallSource:'button-ocr'/);

const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1, 'one module runtime expected');
assert.doesNotThrow(() => new Function(scripts[0][1]
  .replace(/^import .*;$/gm, '')
  .replace(/\bexport\s+/g, '')));

console.log('auto-v34-unified ok');

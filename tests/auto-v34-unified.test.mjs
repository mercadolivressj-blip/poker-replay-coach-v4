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
assert.match(html, /id="export-json"/);
assert.match(html, /function downloadTelemetry/);
assert.match(html, /SSJ_Poker_telemetria_/);
assert.match(html, /downloadTelemetry\('capture-stopped'\)/);
assert.match(html, /const test=window\.__SSJ_TEST=/);
assert.match(html, /window\.__SSJ_EXPORT_TELEMETRY=downloadTelemetry/);
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
assert.match(html, /PokerStarsCardReader/);
assert.match(html, /function deterministicBoard/);
assert.match(html, /function observeLedger/);
assert.match(html, /turn-transition/);
assert.match(html, /card-disappearance/);
assert.match(html, /id="replay-file"/);
assert.match(html, /lastDecisionStreet==='preflop'/);
assert.match(html, /HERO_TURN_RESUME_MS=4000/);
assert.match(html, /function canResumeHeroTurn/);
assert.match(html, /hero-turn-resumed/);
assert.match(html, /function commitmentPixelCanvas[\s\S]*?return captureNative\(x,y,w,h,false\)/);
assert.match(html, /ctx\.imageSmoothingEnabled=smooth/);
const commitmentPixelBody = html.match(/function commitmentPixelCanvas\(seat,tail=false\)\{([\s\S]*?)\n\}/)?.[1] || '';
assert.doesNotMatch(commitmentPixelBody, /drawImage\(video,x,y,w,h/);

const resumeBlock = html.slice(html.indexOf('const HERO_TURN_RESUME_MS='), html.indexOf('async function scanButtons'));
const resumeFactory = new Function('deps', `
 let {state,handId,seatCommit,actions,street,recentHeroTurnClose}=deps;
 ${resumeBlock}
 return {canResumeHeroTurn};
`);
const baseDeps = {
  state:{heroCards:['Ah','Kd'],board:[],legalActions:[]},handId:7,seatCommit:{hero:.02},actions:[{action:'CALL'}],street:()=> 'preflop',
  recentHeroTurnClose:{handId:7,street:'preflop',heroCards:'Ah Kd',board:'',legal:'CALL|FOLD|RAISE',heroCommit:.02,actionCount:1,at:1000},
};
assert.equal(resumeFactory(baseDeps).canResumeHeroTurn(['FOLD','CALL','RAISE'],4999),true,'brief visual dropout resumes the same turn');
assert.equal(resumeFactory(baseDeps).canResumeHeroTurn(['FOLD','CALL','RAISE'],5001),false,'expired dropout opens a new turn');
assert.equal(resumeFactory({...baseDeps,actions:[...baseDeps.actions,{action:'RAISE'}]}).canResumeHeroTurn(['FOLD','CALL','RAISE'],2000),false,'new action prevents false resume');
assert.equal(resumeFactory({...baseDeps,seatCommit:{hero:.05}}).canResumeHeroTurn(['FOLD','CALL','RAISE'],2000),false,'changed hero commitment prevents false resume');
assert.equal(resumeFactory({...baseDeps,street:()=> 'flop'}).canResumeHeroTurn(['FOLD','CALL','RAISE'],2000),false,'street change prevents false resume');

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

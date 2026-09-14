import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyPreflopContext } from '../src/core/preflop-context-r14.js';
import { assignPositions, inferEvents } from '../src/core/table-state-tracker.js';
import { recommendUnopenedPreflop } from '../src/solver/preflop-policy-r14.js';

const c=(rank,suit)=>({rank,suit});
const sbSpot=[
 {seatIndex:0,actorName:'BTN',position:'BTN',committed:0,folded:true,hero:false},
 {seatIndex:1,actorName:'wruckzinho',position:'SB',committed:.01,folded:false,hero:true},
 {seatIndex:2,actorName:'FRYMONY',position:'BB',committed:.02,folded:false,hero:false},
];
let ctx=classifyPreflopContext({seats:sbSpot,heroCommitted:.01,proposedAggressorName:'FRYMONY',proposedAggressorCommitted:.02});
assert.equal(ctx.mode,'unopened','posted BB must not be treated as aggression');
assert.equal(ctx.aggressorName,null);
assert.equal(ctx.bbName,'FRYMONY');

let out=recommendUnopenedPreflop({hero:[c('A','diamonds'),c('6','hearts')],position:'SB',actions:[{type:'fold'},{type:'call',amount:.01},{type:'raise',amount:.04}],pot:.03,sb:.01,bb:.02});
assert.equal(out.decision,'raise','A6o SB unopened must not be auto-folded');
assert.match(out.reason,/blinds.*não agressão|não agressão|unopened/i);
out=recommendUnopenedPreflop({hero:[c('9','clubs'),c('7','clubs')],position:'HJ',actions:[{type:'fold'},{type:'call',amount:.02},{type:'raise',amount:.06}],pot:.03,sb:.01,bb:.02});
assert.equal(out.decision,'fold');

const raised=[
 {actorName:'RaginRJ',position:'UTG',committed:.06,folded:false,hero:false,visibleAction:'raise'},
 {actorName:'SBPlayer',position:'SB',committed:.01,folded:false,hero:false},
 {actorName:'BBPlayer',position:'BB',committed:.02,folded:false,hero:false},
 {actorName:'wruckzinho',position:'BTN',committed:0,folded:false,hero:true},
];
ctx=classifyPreflopContext({seats:raised,heroCommitted:0,proposedAggressorName:'RaginRJ',proposedAggressorCommitted:.06});
assert.equal(ctx.mode,'raised');
assert.equal(ctx.aggressorName,'RaginRJ');
assert.equal(ctx.aggressorCommitted,.06);

const seat=(seatIndex,actorName,stack,committed,dealer,hero)=>({seatIndex,actorName,stack,committed,dealer,folded:false,hero,visibleAction:null,visibleActionAmount:null,confidence:.95});
const six=[seat(0,'djulio94rike',2,0,false,false),seat(1,'RaginRJ',2,0,false,false),seat(2,'TSCardinals',2.88,0,true,false),seat(3,'wruckzinho',.80,.01,false,true),{...seat(4,'Lugar Vazio',null,null,false,false),folded:null},seat(5,'FRYMONY',1.98,.02,false,false)];
const positioned=assignPositions(six);
assert.equal(positioned.find(s=>s.actorName==='wruckzinho')?.position,'SB');
assert.equal(positioned.find(s=>s.actorName==='FRYMONY')?.position,'BB');
assert.equal(positioned.find(s=>s.actorName==='Lugar Vazio')?.position,null);

const prev=[seat(0,'BTN',2,0,true,false),seat(1,'Hero',.99,.01,false,true),seat(2,'BB',1.98,.02,false,false),seat(3,'UTG',2,0,false,false)];
const next=prev.map(s=>s.actorName==='UTG'?{...s,stack:1.94,committed:.06}:s);
const events=inferEvents({handId:12,street:'preflop',seats:assignPositions(prev)},{handId:12,street:'preflop',seats:assignPositions(next)});
assert.equal(events.length,1);
assert.equal(events[0].action,'raise');
assert.equal(events[0].amount,.06);

const bootstrap=fs.readFileSync(new URL('../src/bootstrap-r14.js',import.meta.url),'utf8');
const fundamental=fs.readFileSync(new URL('../src/solver/fundamental-resolver-runtime-r14.js',import.meta.url),'utf8');
const core=fs.readFileSync(new URL('../src/solver/decision-core-r14.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../src/solver/single-decision-ui-r14.js',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../api/decision-state.js',import.meta.url),'utf8');
assert.match(bootstrap,/fundamental-resolver-runtime-r14/);
assert.doesNotMatch(bootstrap,/preflop-policy-runtime-r14/);
assert.match(bootstrap,/single-decision-ui-r14/);
assert.match(fundamental,/recommendUnopenedPreflop/);
assert.match(fundamental,/fundamental-unopened/);
assert.match(core,/classifyPreflopContext/);
assert.match(core,/preflopMode/);
assert.match(ui,/decision-store-only/);
assert.match(ui,/getDecision/);
assert.match(api,/mandatory SB\/BB postings are NOT aggression/);
assert.match(api,/Never call the BB the aggressor merely because BB > SB/);
console.log('PREFLOP CONTEXT R14 passed');

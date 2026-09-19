import assert from 'node:assert/strict';
import { BASELINE_META, baselineChart, baselineRfiPositions, baselineVsNodes, lookupBaseline } from '../src/strategy-v1/ranges-100z.js';
import { pickFromDistribution, preflopBaselineDecision, seedRoll } from '../src/strategy-v1/preflop-baseline.js';
import { preflopDecision } from '../src/brain/preflop.js';
import { normalizeVisionStateV1 } from '../src/core/vision-contract.js';

const RANKS='23456789TJQKA'.split('');
const ALL=[];
for(let i=0;i<13;i++)for(let j=0;j<13;j++){const a=RANKS[12-i],b=RANKS[12-j];ALL.push(i===j?`${a}${a}`:i<j?`${a}${b}s`:`${b}${a}o`);}
const combos=(h)=>h.length===2?6:h.endsWith('s')?4:12;
const TOTAL=1326;
const get=(key,hand)=>key.includes(':')?lookupBaseline({hand,position:key.split(':')[0],versus:key.split(':')[1],node:'vs_open'}):lookupBaseline({hand,position:key,node:'rfi'});
const aggregate=(key,action)=>ALL.reduce((sum,h)=>sum+combos(h)*get(key,h).distribution[action]/100,0)/TOTAL*100;

assert.deepEqual(baselineRfiPositions().sort(),['BTN','CO','HJ','SB','UTG']);
assert.equal(baselineVsNodes().length,15);assert.equal(new Set(baselineVsNodes()).size,15);
for(const key of [...baselineRfiPositions(),...baselineVsNodes()]){
  assert(baselineChart(key));
  for(const h of ALL){const d=get(key,h).distribution;assert.equal(d.fold+d.call+d.raise+d.limp,100,`${key} ${h}`);for(const v of Object.values(d))assert([0,50,100].includes(v),`${key} ${h} freq ${v}`);}
}
assert.equal(BASELINE_META.version,'cash6max-100z-highrake-v1');
assert.equal(BASELINE_META.snapshotSha256,'60da589b490f5c90cf106b18870956d09f0ac257fec4dce516a86f724280a967');
for(const [key,action,expected] of [['UTG','raise',17.3],['CO','raise',27.2],['BTN','raise',40.6],['SB','raise',35.1],['SB','limp',13.7],['BB:UTG','call',19.5],['BB:BTN','raise',14.9],['BTN:CO','raise',13.8]]){
  const actual=aggregate(key,action);assert(Math.abs(actual-expected)<2,`${key} ${action}: ${actual} vs ${expected}`);
}
let sbLimp=0;for(const h of ALL)if(get('SB',h).distribution.limp>0)sbLimp++;assert(sbLimp>0);
for(const key of baselineVsNodes())for(const h of ALL)assert.equal(get(key,h).distribution.limp,0,`${key} ${h} must not limp`);

assert.equal(seedRoll('same-key'),seedRoll('same-key'));
assert.equal(pickFromDistribution({fold:50,call:50,raise:0,limp:0},0),'fold');
assert.equal(pickFromDistribution({fold:50,call:50,raise:0,limp:0},50),'call');
const base={heroCards:['Ah','Kd'],board:[],heroPosition:'BTN',legalActions:['FOLD','RAISE'],actionHistory:['UTG FOLD','HJ FOLD','CO FOLD'],node:'rfi',depthBB:100,format:'cash',tableSize:'6max',decisionKey:'hand-1'};
const ak=preflopBaselineDecision(base);assert.equal(ak.kind,'decision');assert.equal(ak.actionCode,'RAISE');assert.match(ak.engine,/cash6max-100z-highrake-v1/);
const noDepth=preflopBaselineDecision({...base,depthBB:null});assert.equal(noDepth,null);
const wrongButton=preflopBaselineDecision({...base,legalActions:['FOLD']});assert.equal(wrongButton.kind,'inconsistent');
const noMtt=preflopBaselineDecision({...base,format:'mtt'});assert.equal(noMtt,null);
const mixedInput={heroCards:['7h','7d'],board:[],heroPosition:'BB',legalActions:['FOLD','CALL','RAISE'],node:'vs_open',versus:'BTN',depthBB:100,format:'cash',tableSize:'6max',decisionKey:'stable-key'};
const m1=preflopBaselineDecision(mixedInput),m2=preflopBaselineDecision(mixedInput);assert.deepEqual(m1,m2);assert.equal(m1.mixed,true);
const bbFacingUnknown=preflopDecision({
  heroCards:['Ac','Jh'],board:[],heroPosition:'BB',legalActions:['FOLD','CALL','RAISE'],
  actionHistory:[],heroStack:'US$ 24,75',effectiveStack:'US$ 24,75',blinds:'0,10/0,25',toCall:'0,25'
},{format:'cash',tableSize:'6max',handId:'bb-ajo-facing-action'});
assert.equal(bbFacingUnknown.decision,null);
assert.match(bbFacingUnknown.engine,/NODE NÃO CONFIRMADO/);
assert.match(bbFacingUnknown.reason,/não vai presumir RFI/);

const bbBadLegacyHistory=preflopDecision({
  heroCards:['Ac','Jh'],board:[],heroPosition:'BB',legalActions:['FOLD','CALL','RAISE'],
  actionHistory:['UTG FOLD','HJ FOLD','CO FOLD','BTN FOLD','SB FOLD'],
  heroStack:'US$ 24,75',effectiveStack:'US$ 24,75',blinds:'0,10/0,25',toCall:'0,25'
},{format:'cash',tableSize:'6max',handId:'bb-impossible-rfi'});
assert.equal(bbBadLegacyHistory.decision,null);
assert.match(bbBadLegacyHistory.engine,/NODE NÃO CONFIRMADO/);

const coFacingCost=preflopDecision({
  heroCards:['Ks','2c'],board:[],heroPosition:'CO',legalActions:['FOLD','CALL','RAISE'],
  actionHistory:['UTG FOLD','HJ FOLD'],heroStack:'25.91',effectiveStack:'25.91',blinds:'0.10/0.25',toCall:'0.60'
},{format:'cash',tableSize:'6max',handId:'co-k2-facing-cost'});
assert.equal(coFacingCost.decision,null);
assert.match(coFacingCost.engine,/NODE NÃO CONFIRMADO/);
assert.match(coFacingCost.reason,/não vai presumir RFI/);

const normalizedStructured=normalizeVisionStateV1({
  version:'vision-v1',heroCards:['Ac','Jh'],heroPresence:'present',board:[],boardPresence:'absent',
  pot:'0.85',toCall:'0.35',legalActions:['FOLD','CALL','RAISE'],players:6,activePlayers:2,heroPosition:'BB',
  heroStack:'24.75',effectiveStack:'24.75',blinds:'0.10/0.25',seats:[],
  actionHistory:[{position:'HJ',actor:'villain',action:'RAISE',amount:'0.60'}],
  confidence:.9,readerModel:'test',capturedAt:Date.now()
});
assert.deepEqual(normalizedStructured.actionHistory,['HJ villain RAISE 0.60']);

const structuredVsOpen=preflopDecision({
  heroCards:['Ac','Jh'],board:[],heroPosition:'BB',legalActions:['FOLD','CALL','RAISE'],
  actionHistory:[
    {position:'UTG',actor:'u1',action:'FOLD'},
    {position:'HJ',actor:'h1',action:'RAISE',amount:'0.60'},
    {position:'CO',actor:'c1',action:'FOLD'},
    {position:'BTN',actor:'b1',action:'FOLD'},
    {position:'SB',actor:'s1',action:'FOLD'}
  ],
  heroStack:'24.75',effectiveStack:'24.75',blinds:'0.10/0.25',toCall:'0.35'
},{format:'cash',tableSize:'6max',handId:'bb-ajo-structured'});
assert.notEqual(structuredVsOpen.engine,'PREFLOP V1 · NODE NÃO CONFIRMADO');
assert.match(structuredVsOpen.engine,/BASELINE DIRETA/);

const bbLimpOption44=preflopDecision({
  heroCards:['4h','4d'],board:[],heroPosition:'HJ',legalActions:['CHECK','RAISE'],
  actionHistory:['Desmond Lam: POST SB 0.01','N.Neumann.83: POST BB 0.02','wruckzinho: CALL 0.02'],
  heroStack:'1.98',effectiveStack:'1.98',blinds:'0.01/0.02',pot:'0.07',toCall:null
},{format:'cash',tableSize:'6max',handId:'field-bb-option-44'});
assert.equal(bbLimpOption44.decision,'PASSAR');
assert.match(bbLimpOption44.engine,/BB OPTION/);
assert.equal(bbLimpOption44.inferredPosition,'BB');
assert.equal(bbLimpOption44.chartCertified,false);

const bbLimpOptionAQ=preflopDecision({
  heroCards:['Ah','Qh'],board:[],heroPosition:'HJ',legalActions:['CHECK','RAISE'],
  actionHistory:['UTG CALL 0.02'],heroStack:'2.00',effectiveStack:'2.00',blinds:'0.01/0.02',pot:'0.05'
},{format:'cash',tableSize:'6max',handId:'field-bb-option-aqs'});
assert.equal(bbLimpOptionAQ.decision,'AUMENTAR');
assert.match(bbLimpOptionAQ.engine,/BB OPTION/);

console.log('strategy-v1-preflop parity + impossible-RFI + structured-history + BB-option regression: OK');

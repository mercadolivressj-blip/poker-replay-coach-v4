import assert from 'node:assert/strict';
import { BASELINE_META, baselineChart, baselineRfiPositions, baselineVsNodes, lookupBaseline } from '../src/strategy-v1/ranges-100z.js';
import { pickFromDistribution, preflopBaselineDecision, seedRoll } from '../src/strategy-v1/preflop-baseline.js';

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
console.log('strategy-v1-preflop parity: OK');

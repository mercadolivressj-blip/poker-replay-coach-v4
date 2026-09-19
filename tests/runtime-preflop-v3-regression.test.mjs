import assert from 'node:assert/strict';
import fs from 'node:fs';
import { preflopDecision } from '../src/brain/preflop.js';

const unopenedCO=preflopDecision({
  heroCards:['7s','2c'],board:[],heroPosition:'CO',legalActions:['FOLD','CALL','RAISE'],
  actionHistory:['UTG FOLD','HJ FOLD'],heroStack:'2.06',effectiveStack:'2.06',
  blinds:'0.01/0.02',pot:'0.03',toCall:'0.02'
},{format:'cash',tableSize:'6max',handId:'unopened-co-one-bb'});
assert.notEqual(unopenedCO.decision,null,'one-BB entry cost in unopened pot must still produce a preflop decision');
assert.doesNotMatch(unopenedCO.engine,/NODE NÃO CONFIRMADO/);

const bbFacing=preflopDecision({
  heroCards:['Ac','Jh'],board:[],heroPosition:'BB',legalActions:['FOLD','CALL','RAISE'],
  actionHistory:['UTG FOLD','HJ FOLD','CO FOLD','BTN FOLD','SB FOLD'],
  heroStack:'2.00',effectiveStack:'2.00',blinds:'0.01/0.02',pot:'0.05',toCall:'0.02'
},{format:'cash',tableSize:'6max',handId:'bb-facing-one-bb'});
assert.equal(bbFacing.decision,null,'BB with a positive call cost must still fail closed without a confirmed opener');
assert.match(bbFacing.engine,/NODE NÃO CONFIRMADO/);

const runtime=fs.readFileSync(new URL('../standalone-lab/study-runtime-public-v1.html',import.meta.url),'utf8');
assert.match(runtime,/lockedVisualSlots/,'runtime must freeze dealt-in seat observations within a hand');
assert.match(runtime,/slots\.length<=lockedPositionSeatCount/,'runtime must never downgrade table size after folds');
assert.match(runtime,/action==='FOLD'&&localConfirmedActions\.some/,'runtime must dedupe one fold per seat per hand');
assert.match(runtime,/lockedDealerSeat&&hit\.seatId!==lockedDealerSeat/,'dealer must be immutable inside the hand');

console.log('runtime/preflop v3 regression: OK');

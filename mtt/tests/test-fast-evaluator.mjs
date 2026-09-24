import assert from 'node:assert/strict';
import {deck,evaluateSeven,compareScores} from '../src/math/holdem-evaluator.js';
import {fastEvaluate} from '../src/math/fast-holdem-evaluator.js';

function rng(seed=123456789){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296}}
const rand=rng(20260924),d=deck();
for(let t=0;t<500;t++){
 const pool=[...d],cards=[];
 for(let i=0;i<7;i++){const j=i+Math.floor(rand()*(pool.length-i));[pool[i],pool[j]]=[pool[j],pool[i]];cards.push(pool[i])}
 const slow=evaluateSeven(cards),fast=fastEvaluate(cards);
 assert.equal(compareScores(slow,fast),0,`mismatch ${cards.join(' ')} slow=${JSON.stringify(slow)} fast=${JSON.stringify(fast)}`);
}
assert.equal(fastEvaluate(['As','Ks','Qs','Js','Ts','2d','3c']).name,'straight-flush');
assert.equal(fastEvaluate(['Ah','Ad','Ac','As','Kd','2c','3c']).name,'quads');
assert.equal(fastEvaluate(['Ah','Ad','Ac','Ks','Kd','Kc','2c']).name,'full-house');
console.log('PASS — fast evaluator matches exhaustive evaluator on 500 deterministic 7-card samples');

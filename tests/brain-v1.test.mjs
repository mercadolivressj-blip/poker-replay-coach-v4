import assert from 'node:assert/strict';
import { decideBrain, enforceLegal } from '../src/brain/decision.js';

const base = (patch={}) => ({
 version:'vision-v1', heroCards:['Ah','Kd'], heroPresence:'present', board:[], boardPresence:'absent',
 pot:'0.03', toCall:null, legalActions:['FOLD','RAISE'], players:6, activePlayers:6,
 heroPosition:'BTN', heroStack:'2.00', effectiveStack:'2.00', blinds:'0.01/0.02', seats:[],
 actionHistory:['UTG FOLD','HJ FOLD','CO FOLD'], confidence:.99, readerModel:'flash-lite', capturedAt:Date.now(), ...patch
});

{
 const r=decideBrain(base({heroCards:['Ah','Jd']}),{format:'cash',handId:1});
 assert.equal(r.actionCode,'RAISE');
 assert.equal(r.decision,'AUMENTAR');
 assert.match(r.engine,/PREFLOP V1 · BASELINE DIRETA/);
}
{
 const input=base({heroCards:['Kh','Th'],heroPosition:'BB',actionHistory:['BTN RAISE'],legalActions:['FOLD','CALL','RAISE']});
 const r=decideBrain(input,{format:'cash',handId:2});
 const again=decideBrain(input,{format:'cash',handId:2});
 assert(['CALL','RAISE'].includes(r.actionCode));
 assert.equal(r.actionCode,again.actionCode);
 assert.equal(r.details?.mixed ?? r.mixed ?? true,true);
}
{
 const r=decideBrain(base({heroCards:['Ah','Kd'],actionHistory:[],heroStack:'0.12',effectiveStack:'0.12',heroPosition:'BTN',legalActions:['FOLD','ALLIN']}),{format:'mtt',preflopNode:'rfi'});
 assert.equal(r.actionCode,'ALLIN');
 assert.match(r.engine,/MTT SHORT STACK/);
}
{
 const r=decideBrain(base({heroCards:['Ah','Ad'],board:['Ac','7d','2s'],boardPresence:'present',pot:'0.10',legalActions:['CHECK','BET'],actionHistory:['BTN RAISE','BB CALL'],activePlayers:2}),{format:'cash',heroIsPreflopAggressor:true});
 assert.equal(r.engine,'POLICY V4');
 assert.ok(['CHECK','BET','MIXED'].includes(r.actionCode));
 if(r.actionCode==='MIXED') for(const c of r.mixedActionCodes) assert.ok(['CHECK','BET'].includes(c));
}
{
 const r=decideBrain(base({heroCards:['Ah','7d'],board:['Ks','7c','4h','2d','Qc'],boardPresence:'present',pot:'0.20',toCall:'0.18',legalActions:['FOLD','CALL'],activePlayers:2}),{format:'cash'});
 assert.equal(r.engine,'POLICY V4');
 assert.ok(['FOLD','CALL','MIXED'].includes(r.actionCode));
 if(r.actionCode==='MIXED') for(const c of r.mixedActionCodes) assert.ok(['FOLD','CALL'].includes(c));
}
{
 const r=decideBrain(base({heroCards:['Ah','Jd'],actionHistory:[]}),{format:'cash'});
 assert.equal(r.decision,null);
 assert.match(r.reason,/Histórico pré-flop/i);
}
{
 const r=enforceLegal({decision:'ALL-IN',confidence:90,engine:'x',reason:'x'},base({legalActions:['FOLD','CALL']}));
 assert.equal(r.decision,null);
 assert.equal(r.engine,'LEGAL MASK');
}
console.log('brain-v1 regressions: OK');

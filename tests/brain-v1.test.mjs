import assert from 'node:assert/strict';
import { decideBrain, enforceLegal } from '../src/brain/decision.js';

const base = (patch={}) => ({
 version:'vision-v1', heroCards:['Ah','Kd'], heroPresence:'present', board:[], boardPresence:'absent',
 pot:'0.03', toCall:null, legalActions:['FOLD','RAISE'], players:6, activePlayers:6,
 heroPosition:'BTN', heroStack:'2.00', effectiveStack:'2.00', blinds:'0.01/0.02', seats:[], actionHistory:[], confidence:.99, readerModel:'flash-lite', capturedAt:Date.now(), ...patch
});

{
 const r=decideBrain(base({heroCards:['Ah','Jd']}),{format:'cash'});
 assert.equal(r.actionCode,'RAISE');
 assert.equal(r.decision,'AUMENTAR');
 assert.match(r.engine,/PREFLOP V1/);
}
{
 const r=decideBrain(base({heroCards:['Kh','Th'],heroPosition:'BB',actionHistory:['BTN RAISE'],legalActions:['FOLD','CALL','RAISE']}),{format:'cash'});
 assert.equal(r.actionCode,'RAISE');
}
{
 const r=decideBrain(base({heroCards:['Ah','Kd'],heroStack:'0.12',effectiveStack:'0.12',heroPosition:'BTN',legalActions:['FOLD','ALLIN']}),{format:'mtt'});
 assert.equal(r.actionCode,'ALLIN');
 assert.match(r.engine,/MTT SHORT STACK/);
}
{
 const r=decideBrain(base({heroCards:['Ah','Ad'],board:['Ac','7d','2s'],boardPresence:'present',pot:'0.10',legalActions:['CHECK','BET'],actionHistory:['BTN RAISE','BB CALL'],activePlayers:2}),{format:'cash',heroIsPreflopAggressor:true});
 assert.equal(r.actionCode,'BET');
 assert.match(r.decision,/APOSTAR/);
}
{
 const r=decideBrain(base({heroCards:['Ah','7d'],board:['Ks','7c','4h','2d','Qc'],boardPresence:'present',pot:'0.20',toCall:'0.18',legalActions:['FOLD','CALL'],activePlayers:2}),{format:'cash'});
 assert.equal(r.actionCode,'FOLD');
 assert.match(r.reason,/bluff catcher|Bluff catcher|River/i);
}
{
 const r=enforceLegal({decision:'ALL-IN',confidence:90,engine:'x',reason:'x'},base({legalActions:['FOLD','CALL']}));
 assert.equal(r.decision,null);
 assert.equal(r.engine,'LEGAL MASK');
}
console.log('brain-v1 regressions: OK');

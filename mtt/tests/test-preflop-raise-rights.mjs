import assert from 'node:assert/strict';
import {createPreflopEconomy,preflopActionEconomics,applyPreflopAction,preflopPotConservation} from '../src/solver/preflop-economics.js';

// A short all-in does NOT reopen raising to players who already acted since the last full raise.
let s=createPreflopEconomy({tableSize:8,stacksBB:{UTG:20,UTG1:20,LJ:20,HJ:20,CO:20,BTN:2.5,SB:20,BB:20},anteBB:0});
assert.equal(s.raiseGeneration,0);assert.equal(preflopActionEconomics(s,'UTG').raiseRightOpen,true);
s=applyPreflopAction(s,{position:'UTG',action:'RAISE',raiseToBB:2});
assert.equal(s.raiseGeneration,1);assert.equal(s.players.UTG.actedGeneration,1);
s=applyPreflopAction(s,{position:'HJ',action:'CALL'});assert.equal(s.players.HJ.actedGeneration,1);
s=applyPreflopAction(s,{position:'BTN',action:'ALLIN'});assert.equal(s.currentBetBB,2.5);assert.equal(s.history.at(-1).fullRaise,false);assert.equal(s.raiseGeneration,1);
let e=preflopActionEconomics(s,'HJ');assert.equal(e.rawToCallBB,.5);assert.equal(e.raiseRightOpen,false);assert.equal(e.canRaise,false);assert.equal(e.canCall,true);
assert.throws(()=>applyPreflopAction(s,{position:'HJ',action:'RAISE',raiseToBB:4}),/raise_not_reopened/);
// CO has not acted in generation 1, so CO may still make a full raise.
e=preflopActionEconomics(s,'CO');assert.equal(e.raiseRightOpen,true);assert.equal(e.canRaise,true);
s=applyPreflopAction(s,{position:'CO',action:'RAISE',raiseToBB:4});assert.equal(s.raiseGeneration,2);assert.equal(s.history.at(-1).fullRaise,true);
// The full raise reopens action for HJ.
e=preflopActionEconomics(s,'HJ');assert.equal(e.raiseRightOpen,true);assert.equal(e.canRaise,true);
assert.equal(preflopPotConservation(s).valid,true);

// ALLIN below/equal current bet is modeled as an all-in call, not an illegal raise.
let c=createPreflopEconomy({tableSize:8,stacksBB:{UTG:20,UTG1:20,LJ:20,HJ:20,CO:20,BTN:20,SB:20,BB:3},anteBB:.125,anteType:'individual'});
c=applyPreflopAction(c,{position:'UTG',action:'RAISE',raiseToBB:5});
const before=c.potBB;c=applyPreflopAction(c,{position:'BB',action:'ALLIN'});
assert.equal(c.players.BB.behindBB,0);assert.equal(c.history.at(-1).allInCall,true);assert.equal(c.history.at(-1).fullRaise,false);assert.equal(c.currentBetBB,5);assert(c.potBB>before);assert.equal(preflopPotConservation(c).valid,true);

console.log('PASS — preflop raise-right reopening / short all-in / all-in-call regressions');

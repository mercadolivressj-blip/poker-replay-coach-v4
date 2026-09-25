import assert from 'node:assert/strict';
import {createPreflopEconomy,preflopActionEconomics,applyPreflopAction,preflopPotConservation,preflopEffectiveStackBB} from '../src/solver/preflop-economics.js';

let s=createPreflopEconomy({tableSize:8,stacksBB:20,smallBlindBB:.5,bigBlindBB:1,anteBB:.125,anteType:'individual'});
assert.equal(s.potBB,2.5);assert.equal(s.players.SB.anteBB,.125);assert.equal(s.players.SB.liveCommitBB,.5);assert.equal(s.players.SB.totalCommitBB,.625);assert.equal(s.players.BB.totalCommitBB,1.125);assert.equal(s.players.UTG.totalCommitBB,.125);
let e=preflopActionEconomics(s,'UTG');assert.equal(e.rawToCallBB,1);assert.equal(e.minFullRaiseToBB,2);assert.equal(e.maxRaiseToBB,19.875);
assert.equal(preflopPotConservation(s).valid,true);

s=applyPreflopAction(s,{position:'UTG',action:'RAISE',raiseToBB:2.2});
assert.equal(s.potBB,4.7);assert.equal(s.currentBetBB,2.2);assert.equal(s.lastFullRaiseSizeBB,1.2);assert.equal(s.history.at(-1).fullRaise,true);
e=preflopActionEconomics(s,'HJ');assert.equal(e.rawToCallBB,2.2);assert.equal(e.minFullRaiseToBB,3.4);
s=applyPreflopAction(s,{position:'HJ',action:'CALL'});assert.equal(s.potBB,6.9);assert.equal(s.players.HJ.liveCommitBB,2.2);
s=applyPreflopAction(s,{position:'BTN',action:'RAISE',raiseToBB:6.5});assert.equal(s.potBB,13.4);assert.equal(s.currentBetBB,6.5);assert.equal(s.lastFullRaiseSizeBB,4.3);
e=preflopActionEconomics(s,'BB');assert.equal(e.rawToCallBB,5.5);assert.equal(e.minFullRaiseToBB,10.8);assert.equal(preflopPotConservation(s).valid,true);

// Short all-in above the current bet is legal without counting as a full raise.
let short=createPreflopEconomy({tableSize:8,stacksBB:{UTG:20,UTG1:20,LJ:20,HJ:20,CO:20,BTN:20,SB:20,BB:7},anteBB:.125,anteType:'individual'});
short=applyPreflopAction(short,{position:'UTG',action:'RAISE',raiseToBB:2.2});
short=applyPreflopAction(short,{position:'BTN',action:'RAISE',raiseToBB:6.5});
e=preflopActionEconomics(short,'BB');assert.equal(e.maxRaiseToBB,6.875);assert.equal(e.minFullRaiseToBB,10.8);
short=applyPreflopAction(short,{position:'BB',action:'ALLIN'});assert.equal(short.currentBetBB,6.875);assert.equal(short.lastFullRaiseSizeBB,4.3);assert.equal(short.history.at(-1).fullRaise,false);assert.equal(short.players.BB.behindBB,0);assert.equal(preflopPotConservation(short).valid,true);

// Big-blind ante is dead money: it increases pot/total commit but not BB's live bet.
const bba=createPreflopEconomy({tableSize:8,stacksBB:20,anteBB:1,anteType:'big_blind'});
assert.equal(bba.potBB,2.5);assert.equal(bba.players.BB.anteBB,1);assert.equal(bba.players.BB.liveCommitBB,1);assert.equal(bba.players.BB.totalCommitBB,2);assert.equal(preflopActionEconomics(bba,'UTG').rawToCallBB,1);
assert.equal(preflopActionEconomics(bba,'BB').canCheck,true);

assert.throws(()=>applyPreflopAction(s,{position:'CO',action:'CHECK'}),/check_facing_bet/);
assert.throws(()=>applyPreflopAction(s,{position:'CO',action:'RAISE',raiseToBB:8}),/raise_below_min/);
assert.equal(preflopEffectiveStackBB(createPreflopEconomy({tableSize:8,stacksBB:{UTG:12,UTG1:20,LJ:20,HJ:20,CO:20,BTN:20,SB:20,BB:9}}),'UTG','BB'),9);

console.log('PASS — preflop blind/ante/pot/call/raise/all-in economics regressions');

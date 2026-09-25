import assert from 'node:assert/strict';
import {createPreflopEconomy,applyPreflopAction} from '../src/solver/preflop-economics.js';
import {preflopNodeState,preflopNodeKey} from '../src/solver/preflop-node-state.js';

const base=()=>createPreflopEconomy({tableSize:8,stacksBB:20,smallBlindBB:.5,bigBlindBB:1,anteBB:.125,anteType:'individual'});

// Unopened.
let s=base();
let n=preflopNodeState(s,'UTG');
assert.equal(n.node,'UNOPENED');assert.equal(n.pressureLevel,0);assert.equal(n.aggressionCount,0);assert.equal(n.economics.toCallBB,1);assert.equal(n.economics.canRaise,true);

// Limped pot and BB option.
s=applyPreflopAction(base(),{position:'UTG',action:'CALL'});
n=preflopNodeState(s,'HJ');assert.equal(n.node,'VS_LIMPERS');assert.deepEqual(n.limpers,['UTG']);
n=preflopNodeState(s,'BB');assert.equal(n.node,'BB_VS_LIMPERS_OPTION');assert.equal(n.economics.canCheck,true);

// Single open.
s=applyPreflopAction(base(),{position:'UTG',action:'RAISE',raiseToBB:2.2});
n=preflopNodeState(s,'HJ');assert.equal(n.node,'VS_OPEN');assert.equal(n.firstAggressor,'UTG');assert.equal(n.pressureLevel,1);assert.equal(n.economics.toCallBB,2.2);

// Open + caller = squeeze opportunity for a player who has not acted.
s=applyPreflopAction(s,{position:'HJ',action:'CALL'});
n=preflopNodeState(s,'BTN');assert.equal(n.node,'SQUEEZE_OPPORTUNITY');assert.deepEqual(n.coldCallersAfterOpen,['HJ']);assert.equal(n.economics.canRaise,true);

// Original opener facing a full 3-bet.
let three=applyPreflopAction(base(),{position:'UTG',action:'RAISE',raiseToBB:2.2});
three=applyPreflopAction(three,{position:'BTN',action:'RAISE',raiseToBB:6.5});
n=preflopNodeState(three,'UTG');assert.equal(n.node,'VS_3BET');assert.equal(n.aggressionCount,2);assert.equal(n.fullRaiseCount,2);assert.equal(n.lastAggressor,'BTN');assert.equal(n.economics.raiseRightOpen,true);

// Cold player facing open + 3-bet.
n=preflopNodeState(three,'HJ');assert.equal(n.node,'COLD_VS_3BET');

// Caller facing squeeze.
let sq=applyPreflopAction(base(),{position:'UTG',action:'RAISE',raiseToBB:2.2});
sq=applyPreflopAction(sq,{position:'HJ',action:'CALL'});
sq=applyPreflopAction(sq,{position:'BTN',action:'RAISE',raiseToBB:7});
n=preflopNodeState(sq,'HJ');assert.equal(n.node,'CALLER_VS_SQUEEZE');assert.equal(n.heroRole,'CALLER');assert.equal(n.economics.toCallBB,4.8);

// Short all-in raise does NOT reopen action for the opener who already acted.
let short=createPreflopEconomy({tableSize:8,stacksBB:{UTG:20,UTG1:20,LJ:20,HJ:20,CO:20,BTN:20,SB:20,BB:3},anteBB:.125,anteType:'individual'});
short=applyPreflopAction(short,{position:'UTG',action:'RAISE',raiseToBB:2.2});
short=applyPreflopAction(short,{position:'HJ',action:'CALL'});
short=applyPreflopAction(short,{position:'BB',action:'ALLIN'});
n=preflopNodeState(short,'UTG');assert.equal(n.node,'VS_SHORT_3BET_NOT_REOPENED');assert.equal(n.shortRaiseCount,1);assert.equal(n.economics.canRaise,false);assert.equal(n.economics.raiseRightOpen,false);

// Full 4-bet.
let four=applyPreflopAction(base(),{position:'UTG',action:'RAISE',raiseToBB:2.2});
four=applyPreflopAction(four,{position:'BTN',action:'RAISE',raiseToBB:6.5});
four=applyPreflopAction(four,{position:'UTG',action:'RAISE',raiseToBB:12});
n=preflopNodeState(four,'BTN');assert.equal(n.node,'VS_4BET');assert.equal(n.pressureLevel,3);assert.equal(n.lastAggressor,'UTG');

// All-in call is not misclassified as another raise level.
let callJam=createPreflopEconomy({tableSize:8,stacksBB:{UTG:20,UTG1:20,LJ:20,HJ:20,CO:20,BTN:20,SB:20,BB:2},anteBB:.125,anteType:'individual'});
callJam=applyPreflopAction(callJam,{position:'UTG',action:'RAISE',raiseToBB:2.2});
callJam=applyPreflopAction(callJam,{position:'BB',action:'ALLIN'});
n=preflopNodeState(callJam,'HJ');assert.equal(n.aggressionCount,1);assert.equal(n.node,'VS_OPEN');

assert.match(preflopNodeKey(three,'UTG'),/^VS_3BET\|UTG\|p2\|R$/);

console.log('PASS — deterministic MTT preflop node-state routing regressions');

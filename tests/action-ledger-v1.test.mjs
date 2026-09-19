import assert from 'node:assert/strict';
import { parseActionLine, buildLedgerFromState, applyActionHistory, createLedger, ledgerSummary } from '../src/brain/action-ledger.js';
import { createPlayerProfiles, finalizeHandIntoProfiles, playerMetrics, cautiousPlayerLabel } from '../src/brain/player-model.js';

{
  const a = parseActionLine('BTN: raises US$ 0,04 to US$ 0,06', 'preflop');
  assert.equal(a.actor,'BTN'); assert.equal(a.action,'RAISE'); assert.equal(a.street,'preflop');
}
{
  const a = parseActionLine('wruckzinho: paga US$ 0,02', 'flop');
  assert.equal(a.actor,'wruckzinho'); assert.equal(a.action,'CALL'); assert.equal(a.street,'flop');
}
{
  assert.equal(parseActionLine('Dealer: wruckzinho, é a sua vez. Tem 6 segundos para agir','flop'),null);
}
{
  const state={
    board:['5d','6d','2s','Tc'],
    seats:[{name:'wruckzinho',isHero:true}],
    actionHistory:[
      '*** HOLE CARDS ***',
      'UTG folds',
      'CO raises US$ 0.04 to US$ 0.06',
      'BTN folds',
      'wruckzinho: calls US$ 0.04',
      '*** FLOP ***',
      'wruckzinho: checks',
      'CO: bets US$ 0.05',
      'wruckzinho: calls US$ 0.05',
      '*** TURN ***',
      'wruckzinho: checks',
      'CO: checks',
      'CO: checks'
    ]
  };
  const l=buildLedgerFromState(state,{handId:7});
  const s=ledgerSummary(l);
  assert.equal(s.preflopAggressor,'CO');
  assert.equal(s.lastAggressor,'CO');
  assert.equal(s.byStreet.preflop.length,4);
  assert.equal(s.byStreet.flop.length,3);
  assert.equal(s.byStreet.turn.length,2); // repeated snapshot line deduped
  assert.equal(l.heroActor,'wruckzinho');
}
{
  let l=createLedger({handId:11});
  l=applyActionHistory(l,['BTN raises 0.05','BB calls 0.03'],[]);
  l=applyActionHistory(l,['BTN raises 0.05','BB calls 0.03','*** FLOP ***','BB checks','BTN bets 0.05'],['2s','7h','Kd']);
  assert.equal(l.actions.length,4);
  assert.equal(l.preflopAggressor,'BTN');
  assert.equal(l.lastAggressor,'BTN');
}
{
  const l=buildLedgerFromState({board:['2s','7h','Kd'],actionHistory:['BTN raises 0.05','BB calls 0.03','*** FLOP ***','BB checks','BTN bets 0.05']},{handId:21});
  let store=createPlayerProfiles();
  store=finalizeHandIntoProfiles(store,l,{handId:21});
  store=finalizeHandIntoProfiles(store,l,{handId:21}); // idempotent same hand
  const btn=playerMetrics(store.players.BTN), bb=playerMetrics(store.players.BB);
  assert.equal(btn.hands,1); assert.equal(btn.vpip,100); assert.equal(btn.pfr,100);
  assert.equal(bb.hands,1); assert.equal(bb.vpip,100); assert.equal(cautiousPlayerLabel(store.players.BTN).label,'SEM AMOSTRA');
}
console.log('action-ledger-v1 regressions: OK');

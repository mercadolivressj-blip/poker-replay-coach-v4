import assert from 'node:assert/strict';
import { validateActionLedgerV1 } from '../src/core/action-ledger-gate.js';

const events=[
  {id:1,t:10,seat:'rt',action:'FOLD',amount:null,source:'card-presence-delta'},
  {id:2,t:12,seat:'rb',action:'CALL',amount:.5,source:'commitment-delta'},
];

const ok=validateActionLedgerV1({events,unresolved:0,heroTurnConfirmed:true,expectedHistoryCount:2});
assert.equal(ok.complete,true);
assert.equal(ok.source,'seat-state-ledger-v1');

const unresolved=validateActionLedgerV1({events,unresolved:1,heroTurnConfirmed:true,expectedHistoryCount:2});
assert.equal(unresolved.complete,false);
assert(unresolved.errors.includes('ledger_unresolved_actions'));

const short=validateActionLedgerV1({events,unresolved:0,heroTurnConfirmed:true,expectedHistoryCount:3});
assert.equal(short.complete,false);
assert(short.errors.includes('ledger_history_short'));

const textOnly=validateActionLedgerV1({events:[{id:1,t:1,seat:'rt',action:'CALL',amount:.5,source:'transient-text-only'}],unresolved:0,heroTurnConfirmed:true});
assert.equal(textOnly.complete,false);
assert(textOnly.errors.includes('ledger_source_invalid'));

const missingMoney=validateActionLedgerV1({events:[{id:1,t:1,seat:'rt',action:'RAISE',amount:null,source:'commitment-delta'}],unresolved:0,heroTurnConfirmed:true});
assert.equal(missingMoney.complete,false);
assert(missingMoney.errors.includes('ledger_money_missing'));

const noHeroTurn=validateActionLedgerV1({events,unresolved:0,heroTurnConfirmed:false});
assert.equal(noHeroTurn.complete,false);
assert(noHeroTurn.errors.includes('ledger_hero_turn_not_confirmed'));

console.log('action-ledger-gate-v1 ok');

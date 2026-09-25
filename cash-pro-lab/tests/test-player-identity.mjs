import assert from 'node:assert/strict';
import {playerIdentityFromVisibleName,sameIdentity} from '../src/player-identity.mjs';
import {PlayerProfileStore,showdownLineObservations} from '../src/profile-store.mjs';

const a=playerIdentityFromVisibleName('Reg_Master99');
const a2=playerIdentityFromVisibleName('Reg_Master99');
const b=playerIdentityFromVisibleName('OtherReg');
assert(a.resolved && a2.resolved && b.resolved);
assert.equal(a.playerId,a2.playerId);
assert.notEqual(a.playerId,b.playerId);
assert(sameIdentity(a,a2));
assert.equal(playerIdentityFromVisibleName('',{confidence:1}).resolved,false);
assert.equal(playerIdentityFromVisibleName('MaybeReg',{confidence:.93}).resolved,false);

const store=new PlayerProfileStore();
let ia=store.bindSeat({sessionId:'s1',seatId:'top',visibleName:'Reg_Master99',at:1});
store.addHand({identity:ia,sessionId:'s1',handId:1,at:2});
store.observeStat({identity:ia,stat:'riverBluff',success:true,sessionId:'s1',handId:1,street:'river',source:'showdown',at:3});
store.observeLine({identity:ia,key:'river_large_bet_reaches_showdown',success:true,sessionId:'s1',handId:1,street:'river',source:'showdown',at:3});
const snap1=store.snapshot(ia);
assert.equal(snap1.base.handsSeen,1);
assert.equal(snap1.showdowns,1);
assert.equal(snap1.evidenceCount,3);
assert.equal(snap1.exploitWeight,0); // one hand can never drive an exploit

// Same player moves seats: profile follows identity, not chair.
store.unbindSeat({sessionId:'s1',seatId:'top'});
const iaMoved=store.bindSeat({sessionId:'s1',seatId:'left-low',visibleName:'Reg_Master99',at:4});
assert.equal(iaMoved.playerId,ia.playerId);
assert.equal(store.profileForSeat({sessionId:'s1',seatId:'left-low'}).playerId,ia.playerId);
assert.equal(store.snapshot(iaMoved).base.handsSeen,1);

// Same visible identity in a new replay session still resolves to the same profile.
const iaSession2=store.bindSeat({sessionId:'s2',seatId:'right-low',visibleName:'Reg_Master99',at:6});
assert.equal(iaSession2.playerId,ia.playerId);
assert(store.snapshot(iaSession2).sessions.includes('s1'));
assert(store.snapshot(iaSession2).sessions.includes('s2'));

// Different player takes old seat: must NOT inherit profile.
const ib=store.bindSeat({sessionId:'s1',seatId:'top',visibleName:'OtherReg',at:5});
assert.notEqual(ib.playerId,ia.playerId);
assert.equal(store.snapshot(ib).available,true); // bind creates a clean profile
assert.equal(store.snapshot(ib).base.handsSeen,0);
assert.equal(store.snapshot(ib).evidenceCount,0);

// Unresolved identity can never update a profile or create exploit evidence.
const unresolved=store.bindSeat({sessionId:'s1',seatId:'right-high',visibleName:'Unreadable',confidence:.8,at:7});
assert.equal(unresolved.resolved,false);
assert.equal(store.profileForSeat({sessionId:'s1',seatId:'right-high'}),null);
assert.equal(store.addHand({identity:unresolved,sessionId:'s1',handId:2}).applied,false);
assert.equal(store.observeStat({identity:unresolved,stat:'riverBluff',success:true}).applied,false);

// Showdown line extraction is conservative and only records observable line facts.
const obs=showdownLineObservations({
  actions:[
    {street:'flop',action:'BET',sizePct:30},
    {street:'turn',action:'CHECK'},
    {street:'river',action:'BET',sizePct:88}
  ],
  holeCards:['Qh','Th'],board:['4s','2h','Kh','7d','3h']
});
assert(obs.some(x=>x.key==='river_large_bet_reaches_showdown'));
assert(obs.some(x=>x.key==='showdown_observed'));
assert(!obs.some(x=>x.key==='river_overbet_reaches_showdown'));

// A real overbet is separately tracked.
const obs2=showdownLineObservations({
  actions:[{street:'river',action:'BET',sizePct:125}],
  holeCards:['Ah','5h'],board:['4s','2h','Kh','7d','3h']
});
assert(obs2.some(x=>x.key==='river_overbet_reaches_showdown'));

// Evidence cap prevents unbounded post-game profile growth.
const tinyStore=new PlayerProfileStore({maxEvidencePerPlayer:5});
const ic=tinyStore.bindSeat({sessionId:'cap',seatId:'top',visibleName:'EvidenceCapReg'});
for(let i=0;i<12;i++) tinyStore.addHand({identity:ic,sessionId:'cap',handId:i});
assert.equal(tinyStore.snapshot(ic).evidenceCount,5);
assert.equal(tinyStore.snapshot(ic).base.handsSeen,12);

console.log('PASS — Cash Pro Lab V0.6 identity-keyed replay player profiles');

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

// Same player moves seats: profile follows identity, not chair.
store.unbindSeat({sessionId:'s1',seatId:'top'});
const iaMoved=store.bindSeat({sessionId:'s1',seatId:'left-low',visibleName:'Reg_Master99',at:4});
assert.equal(iaMoved.playerId,ia.playerId);
assert.equal(store.profileForSeat({sessionId:'s1',seatId:'left-low'}).playerId,ia.playerId);
assert.equal(store.snapshot(iaMoved).base.handsSeen,1);

// Different player takes old seat: must NOT inherit profile.
const ib=store.bindSeat({sessionId:'s1',seatId:'top',visibleName:'OtherReg',at:5});
assert.notEqual(ib.playerId,ia.playerId);
assert.equal(store.snapshot(ib).available,true); // bind creates a clean profile
assert.equal(store.snapshot(ib).base.handsSeen,0);
assert.equal(store.snapshot(ib).evidenceCount,0);

// Unresolved identity can never update a profile or create exploit evidence.
const unresolved=store.bindSeat({sessionId:'s1',seatId:'right-high',visibleName:'Unreadable',{confidence:.8}});

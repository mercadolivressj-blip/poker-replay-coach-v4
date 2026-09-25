import assert from 'node:assert/strict';
import {normalizeTournamentState} from '../src/core/tournament-state.js';
import {preflopContextFromState} from '../src/strategy/pack-context.js';
import {clearPacks,registerPack} from '../src/strategy/pack-registry.js';
import {decideFromRegisteredPack} from '../src/decision/decision-engine.js';

const raw={tableSize:8,playersDealt:8,heroPosition:'BB',smallBlind:500,bigBlind:1000,ante:125,anteType:'individual',heroStack:10000,villainStack:10000,pot:2500,toCall:9000,history:[{actor:'SB',position:'SB',action:'ALLIN',street:'preflop'}],legalActions:['FOLD','CALL'],hand:'AKo',entrants:1000,remaining:700,paidSpots:150};
const state=normalizeTournamentState(raw),ctx=preflopContextFromState(state);
assert.deepEqual(ctx,{smallBlindBB:.5,anteBB:.125,anteType:'individual',playersDealt:8,forcedPreflopPotBB:2.5});
assert.equal(state.preflop.node,'blind_vs_blind');

clearPacks();
const SNAP='a'.repeat(64);
const baseMeta={game:'NLHE',format:'MTT',mode:'cEV',tableSize:8,stackDepthBB:10,depthPolicy:'exact',node:'blind_vs_blind',heroPosition:'BB',villainPosition:'SB',source:'internal pushfold regression',sourceType:'internal-pushfold-solver',referenceDate:'2026-09-24',certification:'solver-verified',snapshotSha256:SNAP,actionSet:['FOLD','CALL'],contextPolicy:'exact-preflop-forced'};
assert.throws(()=>registerPack(baseMeta,{AKo:{CALL:100}}),/pushfold_solver_requires_exact_context|preflop_context/);
assert.throws(()=>registerPack({...baseMeta,snapshotSha256:null,preflopContext:ctx},{AKo:{CALL:100}}),/pushfold_solver_requires_snapshot_sha256/);
registerPack({...baseMeta,preflopContext:ctx},{AKo:{CALL:100}});
let r=decideFromRegisteredPack(raw,{villainPosition:'SB'});
assert.equal(r.status,'DECISION');
assert.equal(r.decision,'CALL');
assert.equal(r.context.policy,'exact-preflop-forced');

r=decideFromRegisteredPack({...raw,ante:0,pot:1500},{villainPosition:'SB'});
assert.equal(r.status,'OUT_OF_COVERAGE');
r=decideFromRegisteredPack({...raw,playersDealt:7,pot:2375},{villainPosition:'SB'});
assert.equal(r.status,'OUT_OF_COVERAGE');

console.log('PASS — context-sensitive solver packs require exact context and snapshot provenance');

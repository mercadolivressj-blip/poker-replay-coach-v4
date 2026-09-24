import assert from 'node:assert/strict';
import {normalizeTournamentState} from '../src/core/tournament-state.js';

const base={tableSize:8,playersDealt:8,smallBlind:500,bigBlind:1000,ante:125,anteType:'individual',heroStack:20000,villainStack:20000,pot:2500,toCall:0,legalActions:['FOLD','CALL','RAISE'],entrants:1000,remaining:700,paidSpots:150};

let s=normalizeTournamentState({...base,heroPosition:'SB',history:[]});
assert.equal(s.preflop.node,'blind_vs_blind');

s=normalizeTournamentState({...base,heroPosition:'BTN',history:[]});
assert.equal(s.preflop.node,'unopened');

s=normalizeTournamentState({...base,heroPosition:'BB',history:[{actor:'SB',position:'SB',action:'ALLIN',street:'preflop'}]});
assert.equal(s.preflop.node,'blind_vs_blind');
assert.equal(s.preflop.lastAggressorPosition,'SB');

s=normalizeTournamentState({...base,heroPosition:'BB',history:[{actor:'CO',position:'CO',action:'RAISE',street:'preflop'}]});
assert.equal(s.preflop.node,'vs_open');
assert.equal(s.preflop.lastAggressorPosition,'CO');

s=normalizeTournamentState({...base,heroPosition:'BB',history:[{actor:'CO',position:'CO',action:'RAISE',street:'preflop'},{actor:'BTN',position:'BTN',action:'CALL',street:'preflop'}]});
assert.equal(s.preflop.node,'vs_open_multiway');

s=normalizeTournamentState({...base,heroPosition:'BTN',history:[{actor:'CO',position:'CO',action:'RAISE',street:'preflop'},{actor:'BTN',position:'BTN',action:'RAISE',street:'preflop'}]});
assert.equal(s.preflop.node,'vs_3bet');

console.log('PASS — semantic preflop node routing / aggressor position regressions');

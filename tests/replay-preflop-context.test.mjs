import assert from 'node:assert/strict';
import { deriveReplayHeroPosition, inferReplayPreflopContext } from '../src/core/replay-preflop-context.js';

// Folded dealer must remain in the seating ring; filtering isActive=false remapped Hero.
const seatsWithFoldedDealer=[
  {seat:1,name:'Hero',position:null,isHero:true,isDealer:false,isActive:true},
  {seat:2,name:'BB',position:null,isHero:false,isDealer:false,isActive:true},
  {seat:3,name:'UTG',position:null,isHero:false,isDealer:false,isActive:false},
  {seat:4,name:'HJ',position:null,isHero:false,isDealer:false,isActive:false},
  {seat:5,name:'CO',position:null,isHero:false,isDealer:false,isActive:false},
  {seat:6,name:'BTN',position:null,isHero:false,isDealer:true,isActive:false},
];
assert.equal(deriveReplayHeroPosition(seatsWithFoldedDealer),'SB');

// If Vision already supplies Hero position in the seat row, use it directly even if dealer metadata is noisy.
assert.equal(deriveReplayHeroPosition([
  {seat:1,name:'Hero',position:'BB',isHero:true,isDealer:false,isActive:true},
  {seat:2,name:'Villain',position:'UTG',isHero:false,isDealer:false,isActive:true},
]),'BB');

// Screenshot regression: Hero BB, pot = SB + BB + one 2bb open, only opener remains active.
const bbVsOpen=inferReplayPreflopContext({
  board:[],heroPosition:'BB',pot:'0.07',toCall:'0.02',blinds:'0.01/0.02',legalActions:['FOLD','CALL','RAISE'],
  actionHistory:['SB FOLD'],
  seats:[
    {seat:1,position:'BB',isHero:true,isActive:true},
    {seat:2,position:'UTG',isHero:false,isActive:false},
    {seat:3,position:'HJ',isHero:false,isActive:false},
    {seat:4,position:'CO',isHero:false,isActive:false},
    {seat:5,position:'BTN',isHero:false,isActive:true},
    {seat:6,position:'SB',isHero:false,isActive:false},
  ],
});
assert.deepEqual(bbVsOpen,{node:'vs_open',versus:'BTN',source:'sole-active-opponent'});

// Unopened pot: exactly posted blinds, no strategic history => safe RFI context.
const unopened=inferReplayPreflopContext({
  board:[],heroPosition:'CO',pot:'0.03',toCall:'0.02',blinds:'0.01/0.02',legalActions:['FOLD','CALL','RAISE'],
  actionHistory:['UTG FOLD','HJ FOLD'],seats:[],
});
assert.deepEqual(unopened,{node:'rfi',versus:null,source:'posted-blinds-only'});

// Never invent an opener when more than one opponent remains active.
const ambiguous=inferReplayPreflopContext({
  board:[],heroPosition:'BB',pot:'0.11',toCall:'0.04',blinds:'0.01/0.02',legalActions:['FOLD','CALL','RAISE'],
  actionHistory:[],seats:[
    {seat:1,position:'BB',isHero:true,isActive:true},
    {seat:2,position:'UTG',isHero:false,isActive:true},
    {seat:3,position:'HJ',isHero:false,isActive:true},
    {seat:4,position:'CO',isHero:false,isActive:false},
  ],
});
assert.deepEqual(ambiguous,{node:null,versus:null,source:null});

console.log('replay preflop context regression: OK');

import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFlopBoard, materializeFlopBoard, supportedBoardTextures } from '../src/cash-pro-lab/board-factory.js';

test('board classifier recognizes core overlapping flop properties',()=>{
  const dynamic=classifyFlopBoard(['7h','8h','Tc']);
  assert.equal(dynamic.valid,true);
  assert.equal(dynamic.checks['two-tone'],true);
  assert.equal(dynamic.checks.connected,true);
  assert.equal(dynamic.checks.dynamic,true);

  const paired=classifyFlopBoard(['As','Ad','7c']);
  assert.equal(paired.checks.paired,true);
  const mono=classifyFlopBoard(['2h','8h','Kh']);
  assert.equal(mono.checks.monotone,true);
});

test('every supported texture materializes deterministically and self-proves the requested property',()=>{
  for(const textureClass of supportedBoardTextures()){
    const a=materializeFlopBoard({textureClass,seed:123456});
    const b=materializeFlopBoard({textureClass,seed:123456});
    assert.equal(a.ok,true,textureClass);
    assert.deepEqual(a.board,b.board,textureClass);
    assert.equal(new Set(a.board).size,3,textureClass);
    assert.equal(a.proof.checks[textureClass],true,textureClass);
    assert.ok(a.provenance.candidateCount>0,textureClass);
  }
});

test('different seeds provide deterministic board diversity for a texture',()=>{
  const boards=new Set();
  for(let seed=0;seed<20;seed++){
    const out=materializeFlopBoard({textureClass:'two-tone',seed});
    assert.equal(out.ok,true);
    boards.add(out.board.join(''));
  }
  assert.ok(boards.size>10);
});

test('excluded private cards are never reused on the generated flop',()=>{
  const excluded=['As','Kd'];
  const out=materializeFlopBoard({textureClass:'high-card',seed:77,excludeCards:excluded});
  assert.equal(out.ok,true);
  assert.equal(out.board.some(card=>excluded.includes(card)),false);
});

test('unsupported texture and invalid exclusions block instead of falling back silently',()=>{
  assert.equal(materializeFlopBoard({textureClass:'mystery',seed:1}).ok,false);
  const invalid=materializeFlopBoard({textureClass:'dry',seed:1,excludeCards:['ZZ']});
  assert.equal(invalid.ok,false);
  assert.ok(invalid.errors.includes('excluded_card_invalid'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {positionsFromDealer,heroPositionFromDealer,detectDealerButtonSeat} from '../src/core/dealer-button.js';

test('derives 5-max hero BB when dealer is right-high',()=>{
  const slots=['hero','left-low','top','right-high','right-low'];
  const map=positionsFromDealer(slots,'right-high');
  assert.equal(map['right-high'],'BTN');
  assert.equal(map['right-low'],'SB');
  assert.equal(map.hero,'BB');
  assert.equal(heroPositionFromDealer(slots,'right-high'),'BB');
});

test('derives 6-max positions clockwise from dealer',()=>{
  const slots=['hero','left-low','left-high','top','right-high','right-low'];
  const map=positionsFromDealer(slots,'top');
  assert.equal(map.top,'BTN');
  assert.equal(map['right-high'],'SB');
  assert.equal(map['right-low'],'BB');
  assert.equal(map.hero,'UTG');
});

test('detects compact red-white dealer disc near right-high seat',()=>{
  const w=480,h=270,data=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<data.length;i+=4){data[i]=15;data[i+1]=35;data[i+2]=24;data[i+3]=255;}
  const felt={x:.24,y:.23,w:.52,h:.42};
  // Dealer disc near the right-high perimeter anchor.
  const cx=Math.round((felt.x+felt.w*.94)*w),cy=Math.round((felt.y+felt.h*.18)*h),rad=6;
  for(let y=cy-rad;y<=cy+rad;y++)for(let x=cx-rad;x<=cx+rad;x++){
    const d=Math.hypot(x-cx,y-cy);if(d>rad)continue;const i=(y*w+x)*4;
    if(d>rad*.58){data[i]=235;data[i+1]=235;data[i+2]=232;}else{data[i]=220;data[i+1]=45;data[i+2]=55;}
  }
  // Red/white decoy inside the felt core must be ignored.
  const dx=Math.round((felt.x+felt.w*.5)*w),dy=Math.round((felt.y+felt.h*.5)*h);
  for(let y=dy-8;y<=dy+8;y++)for(let x=dx-12;x<=dx+12;x++){
    const i=(y*w+x)*4;data[i]=230;data[i+1]=(x%2?230:40);data[i+2]=(x%2?230:45);
  }
  const hit=detectDealerButtonSeat(data,w,h,felt);
  assert.ok(hit);
  assert.equal(hit.seatId,'right-high');
});

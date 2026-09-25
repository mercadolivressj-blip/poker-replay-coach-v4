import {POPULATION_PRIOR, statNames} from './opponents.mjs';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));

export function createPlayerModel({priorStrength=24}={}){
  const stats={};
  for(const name of statNames()){
    const p=POPULATION_PRIOR[name];
    stats[name]={success:p*priorStrength, failure:(1-p)*priorStrength, observed:0};
  }
  return {version:'player-model-v0.1', priorStrength, handsSeen:0, stats};
}

export function observe(model, stat, success, weight=1){
  if(!model?.stats?.[stat]) throw new Error(`unknown_stat:${stat}`);
  const w=Math.max(0,Number(weight)||0);
  if(success) model.stats[stat].success += w;
  else model.stats[stat].failure += w;
  model.stats[stat].observed += w;
  return model;
}

export function addHand(model, n=1){
  model.handsSeen += Math.max(0, Number(n)||0);
  return model;
}

export function estimate(model, stat){
  const s=model?.stats?.[stat];
  if(!s) throw new Error(`unknown_stat:${stat}`);
  const total=s.success+s.failure;
  const mean=total ? s.success/total : POPULATION_PRIOR[stat];
  const confidence=clamp(s.observed/(s.observed+30));
  return {mean, confidence, observations:s.observed};
}

export function profileSnapshot(model){
  const out={handsSeen:model.handsSeen, trusted:false, confidence:0, stats:{}};
  let sum=0, n=0;
  for(const name of statNames()){
    const e=estimate(model,name);
    out.stats[name]=e;
    sum += e.confidence; n++;
  }
  out.confidence=n?sum/n:0;
  out.trusted=model.handsSeen>=40 && out.confidence>=0.25;
  return out;
}

export function exploitWeight(model){
  const snap=profileSnapshot(model);
  if(!snap.trusted) return 0;
  return clamp((model.handsSeen-40)/160,0,1)*clamp(snap.confidence/0.75,0,1);
}

export function blendPopulationWithPlayer(model, stat){
  const e=estimate(model,stat);
  const w=exploitWeight(model);
  return {value:POPULATION_PRIOR[stat]*(1-w)+e.mean*w, exploitWeight:w, estimate:e};
}

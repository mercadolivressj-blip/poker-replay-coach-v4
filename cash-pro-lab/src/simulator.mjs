import {getArchetype, statNames} from './opponents.mjs';
import {createPlayerModel, observe, addHand, profileSnapshot, blendPopulationWithPlayer} from './player-model.mjs';

function mulberry32(seed){
  let a=seed>>>0;
  return function(){
    a|=0;a=a+0x6D2B79F5|0;
    let t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}

export function simulatePlayerLearning({archetype='BALANCED_REG',hands=200,seed=1,priorStrength=24}={}){
  const truth=getArchetype(archetype);
  const rng=mulberry32(seed);
  const model=createPlayerModel({priorStrength});
  const stats=statNames();

  for(let h=0;h<hands;h++){
    addHand(model,1);
    // Not every hand creates an opportunity for every statistic.
    for(const stat of stats){
      const opportunity = stat==='vpip' || stat==='pfr' ? 1 : 0.32;
      if(rng()>opportunity) continue;
      observe(model,stat,rng()<truth[stat]);
    }
  }
  return {truth,model,snapshot:profileSnapshot(model)};
}

export function learningError(result){
  let abs=0,n=0;
  for(const stat of statNames()){
    const est=blendPopulationWithPlayer(result.model,stat).value;
    abs+=Math.abs(est-result.truth[stat]); n++;
  }
  return n?abs/n:0;
}

export function compareLearning({archetype='AGGRO_REG',seed=1,shortHands=20,longHands=300}={}){
  const short=simulatePlayerLearning({archetype,hands:shortHands,seed});
  const long=simulatePlayerLearning({archetype,hands:longHands,seed});
  return {short,long,shortError:learningError(short),longError:learningError(long)};
}

import {ARCHETYPES} from './opponents.mjs';
import {simulatePlayerLearning,learningError} from './simulator.mjs';
import {runRiverStressSuite} from './adversarial-river.mjs';

const DEFAULT_REGS=['BALANCED_REG','TIGHT_REG','AGGRO_REG','LAG_REG','TRICKY_REG'];
const DEFAULT_DEPTHS=[20,30,40,50,75,100,150,200];

function mean(xs){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;}
function max(xs){return xs.length?Math.max(...xs):0;}
function round(x,n=6){const p=10**n;return Math.round(x*p)/p;}

export function runLearningArena({archetypes=DEFAULT_REGS,handsPerProfile=300,seeds=8,seed=20260925}={}){
  const rows=[];
  for(const id of archetypes){
    if(!ARCHETYPES[id]) throw new Error(`unknown_archetype:${id}`);
    for(let i=0;i<seeds;i++){
      const result=simulatePlayerLearning({archetype:id,hands:handsPerProfile,seed:seed+i*104729});
      rows.push({archetype:id,seed:seed+i*104729,hands:handsPerProfile,error:learningError(result)});
    }
  }
  const byArchetype={};
  for(const id of archetypes){
    const subset=rows.filter(r=>r.archetype===id);
    byArchetype[id]={
      samples:subset.length,
      meanAbsError:round(mean(subset.map(r=>r.error))),
      worstAbsError:round(max(subset.map(r=>r.error)))
    };
  }
  return {
    version:'strong-reg-learning-arena-v0.8',
    handsPerProfile,seeds,profiles:archetypes.length,totalRuns:rows.length,
    meanAbsError:round(mean(rows.map(r=>r.error))),
    worstAbsError:round(max(rows.map(r=>r.error))),
    byArchetype,rows
  };
}

export function runRiverArena({archetypes=DEFAULT_REGS,depths=DEFAULT_DEPTHS,samplesPerCell=48,seed=20260925}={}){
  const cells=[];
  let totalSamples=0,totalInvalid=0,totalBlocked=0,totalRegret=0,totalMistakes=0;
  for(let ai=0;ai<archetypes.length;ai++){
    const archetype=archetypes[ai];
    if(!ARCHETYPES[archetype]) throw new Error(`unknown_archetype:${archetype}`);
    for(let di=0;di<depths.length;di++){
      const depthBb=depths[di];
      // The underlying generator already varies texture and sizing. We intentionally
      // use a disjoint deterministic seed window for each profile/depth cell.
      const suite=runRiverStressSuite({samples:samplesPerCell,seed:seed+ai*1000003+di*10007});
      const valid=suite.samples-suite.invalid;
      const regret=suite.regret?.totalRegret ?? 0;
      const mistakes=suite.regret?.mistakes ?? 0;
      cells.push({
        archetype,depthBb,samples:suite.samples,valid,invalid:suite.invalid,
        calls:suite.calls,folds:suite.folds,blockedAggression:suite.blockedAggression,
        regret:round(regret),mistakes
      });
      totalSamples+=suite.samples;totalInvalid+=suite.invalid;totalBlocked+=suite.blockedAggression;
      totalRegret+=regret;totalMistakes+=mistakes;
    }
  }
  return {
    version:'strong-reg-river-arena-v0.8',
    profiles:archetypes.length,depths:[...depths],samplesPerCell,totalSamples,totalInvalid,totalBlocked,
    totalRegret:round(totalRegret),totalMistakes,cells
  };
}

export function runStrongRegArena(opts={}){
  const learning=runLearningArena(opts.learning||{});
  const river=runRiverArena(opts.river||{});
  const gates={
    deterministicCoverage: river.totalInvalid===0,
    playerLearningHealthy: learning.meanAbsError<=0.08 && learning.worstAbsError<=0.16,
    terminalAggressionProtected: river.totalBlocked>0,
    fieldCertified:false
  };
  return {
    version:'ssj-cash-pro-lab-v0.8-strong-reg-arena',
    mode:'OFFLINE_REPLAY_STUDY_ONLY',
    learning,river,gates,
    pass:gates.deterministicCoverage&&gates.playerLearningHealthy&&gates.terminalAggressionProtected,
    note:'Synthetic arena is a stress-test. Passing does not prove real-world win rate or field certification.'
  };
}

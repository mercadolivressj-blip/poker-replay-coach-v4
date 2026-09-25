import {ARCHETYPES} from './opponents.mjs';
import {simulatePlayerLearning,learningError} from './simulator.mjs';
import {generateRiverScenario} from './adversarial-river.mjs';
import {auditDecision,aggregateRegret} from './regret.mjs';

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
      const runSeed=seed+i*104729;
      const result=simulatePlayerLearning({archetype:id,hands:handsPerProfile,seed:runSeed});
      rows.push({archetype:id,seed:runSeed,hands:handsPerProfile,error:learningError(result)});
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
  let totalSamples=0,totalInvalid=0,totalBlocked=0;
  const allAudits=[];
  for(let ai=0;ai<archetypes.length;ai++){
    const archetype=archetypes[ai];
    if(!ARCHETYPES[archetype]) throw new Error(`unknown_archetype:${archetype}`);
    for(let di=0;di<depths.length;di++){
      const depthBb=depths[di];
      const audits=[];
      let calls=0,folds=0,blockedAggression=0,invalid=0,minEdge=Infinity,maxEdge=-Infinity;
      for(let i=0;i<samplesPerCell;i++){
        try{
          const row=generateRiverScenario({
            seed:seed+ai*1000003+di*10007+i*7919,
            archetype,depthBb
          });
          if(row.archetype!==archetype || row.depthBb!==depthBb) throw new Error('scenario_context_mismatch');
          if(row.callAudit.action==='CALL')calls++;else folds++;
          if(!row.aggressionGate.allowed)blockedAggression++;
          minEdge=Math.min(minEdge,row.callAudit.edge);maxEdge=Math.max(maxEdge,row.callAudit.edge);
          // Inject a known mistake periodically so regret plumbing is continuously tested.
          const selected=i%7===0?(row.callAudit.action==='CALL'?'FOLD':'CALL'):row.callAudit.action;
          const audit=auditDecision({selectedAction:selected,actionEVs:{FOLD:0,CALL:row.callAudit.callEv}});
          audits.push(audit);allAudits.push(audit);
        }catch(error){invalid++;}
      }
      const regret=aggregateRegret(audits);
      cells.push({
        archetype,depthBb,samples:samplesPerCell,valid:samplesPerCell-invalid,invalid,
        calls,folds,blockedAggression,
        minEdge:Number.isFinite(minEdge)?round(minEdge):null,
        maxEdge:Number.isFinite(maxEdge)?round(maxEdge):null,
        regret:{
          decisions:regret.decisions,
          totalRegretBB:round(regret.totalRegretBB),
          avgRegretBB:round(regret.avgRegretBB),
          severeRate:round(regret.severeRate),
          materialRate:round(regret.materialRate)
        }
      });
      totalSamples+=samplesPerCell;totalInvalid+=invalid;totalBlocked+=blockedAggression;
    }
  }
  const regret=aggregateRegret(allAudits);
  return {
    version:'strong-reg-river-arena-v0.8',
    profiles:archetypes.length,depths:[...depths],samplesPerCell,totalSamples,totalInvalid,totalBlocked,
    regret:{
      decisions:regret.decisions,totalRegretBB:round(regret.totalRegretBB),avgRegretBB:round(regret.avgRegretBB),
      severeRate:round(regret.severeRate),materialRate:round(regret.materialRate)
    },
    cells
  };
}

export function runStrongRegArena(opts={}){
  const learning=runLearningArena(opts.learning||{});
  const river=runRiverArena(opts.river||{});
  const gates={
    deterministicCoverage: river.totalInvalid===0,
    playerLearningHealthy: learning.meanAbsError<=0.08 && learning.worstAbsError<=0.16,
    terminalAggressionProtected: river.totalBlocked>0,
    allDepthsCovered: river.cells.length===river.profiles*river.depths.length,
    fieldCertified:false
  };
  return {
    version:'ssj-cash-pro-lab-v0.8-strong-reg-arena',
    mode:'OFFLINE_REPLAY_STUDY_ONLY',
    learning,river,gates,
    pass:gates.deterministicCoverage&&gates.playerLearningHealthy&&gates.terminalAggressionProtected&&gates.allDepthsCovered,
    note:'Synthetic arena is a stress-test. Passing does not prove real-world win rate or field certification.'
  };
}

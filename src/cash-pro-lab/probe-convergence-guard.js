function finiteNumber(v){return typeof v==='number'&&Number.isFinite(v);}

export function parseNashConvCheckpoint(line){
  const m=String(line||'').match(/iter\s+(\d+)\s+NashConv\s+([-+0-9.eE]+)\s+chips\s+([-+0-9.eE]+)% of pot/);
  if(!m) return null;
  const iterations=Number(m[1]);
  const chips=Number(m[2]);
  const pct=Number(m[3]);
  if(!Number.isInteger(iterations)||iterations<1||!finiteNumber(chips)||!finiteNumber(pct)||pct<0) return null;
  return {iterations,chips,pct};
}

export const DEFAULT_PROBE_GUARD=Object.freeze({
  targetConfirmationCheckpoints:3,
  minCheckpointsForDivergence:4,
  hardExplosionRatio:3,
  hardExplosionMinDeltaPct:0.5,
  consecutiveRegressionCheckpoints:3,
  regressionRatio:1.5,
  regressionMinDeltaPct:0.35,
});

function bestReport(curve){
  if(!Array.isArray(curve)||curve.length===0) return null;
  return curve.reduce((best,row)=>row.pct<best.pct?row:best,curve[0]);
}

export function assessProbeCurve(curve,{targetPct=0.25,guard=DEFAULT_PROBE_GUARD}={}){
  if(!Array.isArray(curve)||curve.length===0){
    return {status:'WAITING_FOR_CHECKPOINT',stop:false,ready:false,reason:null,best:null,last:null};
  }
  const last=curve.at(-1);
  const best=bestReport(curve);
  if(!finiteNumber(targetPct)||targetPct<=0) throw new TypeError('targetPct must be finite and > 0');

  const confirms=Math.max(2,Number(guard.targetConfirmationCheckpoints)||3);
  const confirmTail=curve.slice(-confirms);
  if(confirmTail.length===confirms&&confirmTail.every(row=>row.pct<=targetPct)){
    return {
      status:'TARGET_STABLE',stop:true,ready:true,reason:'nashconv_target_stable',best,last,
      detail:{confirmations:confirmTail},
    };
  }
  if(last.pct<=targetPct){
    return {
      status:'TARGET_CONFIRMING',stop:false,ready:false,reason:'nashconv_target_needs_confirmation',best,last,
      detail:{required:confirms,consecutive:confirmTail.filter(row=>row.pct<=targetPct).length},
    };
  }

  if(curve.length<guard.minCheckpointsForDivergence){
    return {status:'RUNNING',stop:false,ready:false,reason:null,best,last};
  }

  const prior=curve.slice(0,-1);
  const priorBest=bestReport(prior);
  const hardExplosion=priorBest&&
    last.pct>=priorBest.pct*guard.hardExplosionRatio&&
    last.pct-priorBest.pct>=guard.hardExplosionMinDeltaPct;
  if(hardExplosion){
    return {
      status:'DIVERGED',stop:true,ready:false,reason:'hard_nashconv_explosion',best,last,
      detail:{priorBest,ratio:last.pct/priorBest.pct,deltaPct:last.pct-priorBest.pct},
    };
  }

  const need=guard.consecutiveRegressionCheckpoints;
  const tail=curve.slice(-(need+1));
  const consecutivelyWorse=tail.length===need+1&&tail.slice(1).every((row,i)=>row.pct>tail[i].pct);
  const regressionTooLarge=priorBest&&
    last.pct>=priorBest.pct*guard.regressionRatio&&
    last.pct-priorBest.pct>=guard.regressionMinDeltaPct;
  if(consecutivelyWorse&&regressionTooLarge){
    return {
      status:'DIVERGED',stop:true,ready:false,reason:'sustained_nashconv_regression',best,last,
      detail:{priorBest,tail,ratio:last.pct/priorBest.pct,deltaPct:last.pct-priorBest.pct},
    };
  }

  return {status:'RUNNING',stop:false,ready:false,reason:null,best,last};
}

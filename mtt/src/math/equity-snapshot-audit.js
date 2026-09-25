import {verifyEquityMatrixSnapshot} from './equity-matrix-snapshot.js';
import {auditEquityMatrixReplicates} from './equity-stability.js';

export function auditEquitySnapshots({snapshots,maxMeanAbsDiff=.012,maxMaxAbsDiff=.04}={}){
 if(!Array.isArray(snapshots)||snapshots.length<2)throw new Error('equity_snapshot_audit_requires_2_snapshots');
 const verified=snapshots.map((s,i)=>({index:i,...verifyEquityMatrixSnapshot(s)}));
 const bad=verified.find(x=>!x.valid);if(bad)throw new Error(`equity_snapshot_audit_invalid_snapshot:${bad.index}:${bad.errors.join(',')}`);
 const first=snapshots[0],hands=first.hands||[];
 for(let i=1;i<snapshots.length;i++){
  const s=snapshots[i];
  if(JSON.stringify(s.hands)!==JSON.stringify(hands))throw new Error(`equity_snapshot_audit_hands_mismatch:${i}`);
  if(Number(s.iterationsPerPair)!==Number(first.iterationsPerPair))throw new Error(`equity_snapshot_audit_iterations_mismatch:${i}`);
  if(String(s.evaluatorVersion)!==String(first.evaluatorVersion))throw new Error(`equity_snapshot_audit_evaluator_mismatch:${i}`);
  if(String(s.seed)===String(first.seed))throw new Error(`equity_snapshot_audit_seed_not_independent:${i}`);
 }
 const stability=auditEquityMatrixReplicates({runs:snapshots.map(s=>({matrix:s.matrix})),hands,maxMeanAbsDiff,maxMaxAbsDiff});
 return{schema:'ssj-mtt-equity-snapshot-audit-v1',stable:stability.stable,snapshotCount:snapshots.length,snapshotShas:snapshots.map(s=>s.sha256),seeds:snapshots.map(s=>s.seed),iterationsPerPair:Number(first.iterationsPerPair),evaluatorVersion:first.evaluatorVersion,stability};
}

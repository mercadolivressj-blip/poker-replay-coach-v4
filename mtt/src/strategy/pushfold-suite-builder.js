import {all169,normalizeHandClass} from '../core/hand-class.js';
import {verifyEquityMatrixSnapshot} from '../math/equity-matrix-snapshot.js';
import {solvePushFoldConsensus} from '../solver/pushfold-consensus.js';
import {pushFoldGameFromPreflopContext,attachEffectiveStackToContext} from '../solver/pushfold-context.js';
import {buildBlindVsBlindPushFoldPacks} from './pushfold-pack-builder.js';
import {validatePreflopContext} from './pack-context.js';
import {sealPushFoldSuite} from './pushfold-suite-integrity.js';

const uniq=x=>[...new Set(x)];
const sorted=x=>[...x].sort();
const exact169=hands=>{
 const got=sorted(uniq((hands||[]).map(normalizeHandClass).filter(Boolean))),want=sorted(all169());
 return got.length===169&&JSON.stringify(got)===JSON.stringify(want);
};

export function validateProductionEquityEvidence({snapshot,audit,requireFull169=true}={}){
 const errors=[];
 const sv=verifyEquityMatrixSnapshot(snapshot||{});
 if(!sv.valid)errors.push(...sv.errors.map(x=>`snapshot_${x}`));
 if(requireFull169&&!exact169(snapshot?.hands))errors.push('snapshot_not_full_169');
 if(audit?.schema!=='ssj-mtt-equity-snapshot-audit-v1')errors.push('audit_schema_invalid');
 if(audit?.stable!==true)errors.push('audit_not_stable');
 if(!(Number(audit?.snapshotCount)>=2))errors.push('audit_requires_2_snapshots');
 const shas=Array.isArray(audit?.snapshotShas)?audit.snapshotShas.map(x=>String(x).toLowerCase()):[];
 if(snapshot?.sha256&&!shas.includes(String(snapshot.sha256).toLowerCase()))errors.push('audit_missing_snapshot_sha');
 if(Number(audit?.iterationsPerPair)!==Number(snapshot?.iterationsPerPair))errors.push('audit_iterations_mismatch');
 if(String(audit?.evaluatorVersion||'')!==String(snapshot?.evaluatorVersion||''))errors.push('audit_evaluator_mismatch');
 const seeds=Array.isArray(audit?.seeds)?audit.seeds.map(String):[];
 if(seeds.length<2||uniq(seeds).length!==seeds.length)errors.push('audit_seeds_not_independent');
 if(audit?.stability?.stable!==true)errors.push('audit_stability_report_not_stable');
 return{valid:errors.length===0,errors,full169:exact169(snapshot?.hands),snapshotSha256:snapshot?.sha256||null,auditSnapshotShas:shas};
}

function normalizeDepths(depths){
 const out=uniq((depths||[]).map(Number).filter(x=>Number.isFinite(x)&&x>0)).sort((a,b)=>a-b);
 if(!out.length)throw new Error('pushfold_suite_depths_empty');
 return out;
}

function consensusForDepth(depthProfiles,depth){
 if(Array.isArray(depthProfiles))return depthProfiles.find(x=>Number(x?.depthBB)===Number(depth))?.consensus||null;
 return depthProfiles?.[depth]||depthProfiles?.[String(depth)]||null;
}

export function buildVerifiedPushFoldSuiteFromConsensus({snapshot,audit,preflopContext,depths,depthProfiles,referenceDate='2026-09-24'}={}){
 const evidence=validateProductionEquityEvidence({snapshot,audit,requireFull169:true});
 if(!evidence.valid)throw new Error(`pushfold_suite_equity_evidence_invalid:${evidence.errors.join(',')}`);
 const cv=validatePreflopContext(preflopContext||{});if(!cv.valid)throw new Error(`pushfold_suite_context_invalid:${cv.errors.join(',')}`);
 const ds=normalizeDepths(depths),packs=[],reports=[];
 for(const depthBB of ds){
  const consensus=consensusForDepth(depthProfiles,depthBB);
  if(!consensus)throw new Error(`pushfold_suite_consensus_missing:${depthBB}`);
  if(consensus.verificationReady!==true)throw new Error(`pushfold_suite_depth_not_verified:${depthBB}`);
  if(consensus.solverConsensus!==true)throw new Error(`pushfold_suite_solver_consensus_missing:${depthBB}`);
  if(consensus.equityStable!==true)throw new Error(`pushfold_suite_equity_stability_missing:${depthBB}`);
  const auditShas=consensus?.equityAudit?.snapshotShas||[];
  if(!auditShas.map(x=>String(x).toLowerCase()).includes(String(snapshot.sha256).toLowerCase()))throw new Error(`pushfold_suite_consensus_snapshot_mismatch:${depthBB}`);
  const built=buildBlindVsBlindPushFoldPacks({consensus,preflopContext,effectiveStackBB:depthBB,equitySnapshotSha256:snapshot.sha256,referenceDate,promoteVerified:true,engine:'regret',requireFull169:true});
  packs.push({depthBB,side:'SB',...built.sb},{depthBB,side:'BB',...built.bb});
  reports.push({depthBB,solverConsensus:true,equityStable:true,verificationReady:true,regretNashConv:Number(consensus.regret?.nashConv),fictitiousNashConv:Number(consensus.fictitious?.nashConv),agreement:consensus.agreement});
 }
 const suite={schema:'ssj-mtt-pushfold-suite-v1',certification:'solver-verified',game:'NLHE',format:'MTT',mode:'cEV',node:'blind_vs_blind',tableSize:Number(preflopContext.playersDealt),preflopContext:{...preflopContext},snapshotSha256:snapshot.sha256,equityAudit:{schema:audit.schema,snapshotShas:[...audit.snapshotShas],seeds:[...audit.seeds],iterationsPerPair:Number(audit.iterationsPerPair),evaluatorVersion:audit.evaluatorVersion,stability:audit.stability},depths:ds,reports,packs};
 return sealPushFoldSuite(suite);
}

export function solveAndBuildVerifiedPushFoldSuite({snapshot,audit,preflopContext,depths,referenceDate='2026-09-24',solverOptions={}}={}){
 const evidence=validateProductionEquityEvidence({snapshot,audit,requireFull169:true});
 if(!evidence.valid)throw new Error(`pushfold_suite_equity_evidence_invalid:${evidence.errors.join(',')}`);
 const cv=validatePreflopContext(preflopContext||{});if(!cv.valid)throw new Error(`pushfold_suite_context_invalid:${cv.errors.join(',')}`);
 const ds=normalizeDepths(depths),profiles={};
 for(const depthBB of ds){
  const game=pushFoldGameFromPreflopContext(attachEffectiveStackToContext(preflopContext,depthBB));
  const consensus=solvePushFoldConsensus({game,equityMatrix:snapshot.matrix,equityAudit:audit,hands:snapshot.hands,...solverOptions});
  if(!consensus.verificationReady)throw new Error(`pushfold_suite_depth_not_verified:${depthBB}:${JSON.stringify({nashConvRegret:consensus.regret?.nashConv,nashConvFictitious:consensus.fictitious?.nashConv,agreement:consensus.agreement,checks:consensus.checks})}`);
  profiles[depthBB]=consensus;
 }
 return buildVerifiedPushFoldSuiteFromConsensus({snapshot,audit,preflopContext,depths:ds,depthProfiles:profiles,referenceDate});
}

import {createHash} from 'node:crypto';
import {all169,normalizeHandClass} from '../core/hand-class.js';
import {validatePreflopContext} from './pack-context.js';

const SHA=/^[a-f0-9]{64}$/i;
const expectedHands=[...all169()].sort();
const finitePositive=x=>Number.isFinite(Number(x))&&Number(x)>0;

function stable(value){
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object'){
  const out={};for(const k of Object.keys(value).sort())out[k]=stable(value[k]);return out;
 }
 return value;
}
function json(value){return JSON.stringify(stable(value))}
function stripHash(suite={}){const {suiteSha256,...rest}=suite||{};return rest}
export function pushFoldSuiteSha256(suite={}){return createHash('sha256').update(json(stripHash(suite))).digest('hex')}
export function sealPushFoldSuite(suite={}){const base=stripHash(suite);return{...base,suiteSha256:pushFoldSuiteSha256(base)}}

function sameContext(a,b){return json(a||{})===json(b||{})}
function chartValidation(chart,allowed){
 const errors=[],keys=Object.keys(chart||{}).map(normalizeHandClass).filter(Boolean).sort();
 if(keys.length!==169||json(keys)!==json(expectedHands))errors.push(`chart_not_exact_169:${keys.length}`);
 for(const [hand,dist] of Object.entries(chart||{})){
  if(!normalizeHandClass(hand)){errors.push(`bad_hand:${hand}`);continue}
  const entries=Object.entries(dist||{});if(!entries.length){errors.push(`empty_distribution:${hand}`);continue}
  let total=0;
  for(const [action,weight] of entries){const a=String(action).toUpperCase(),w=Number(weight);if(!allowed.has(a))errors.push(`illegal_pack_action:${hand}:${a}`);if(!finitePositive(w))errors.push(`bad_weight:${hand}:${a}`);else total+=w}
  if(!(total>0))errors.push(`zero_distribution:${hand}`);
 }
 return errors;
}

export function validatePushFoldSuite(suite={},{requireHash=true}={}){
 const errors=[];
 if(suite.schema!=='ssj-mtt-pushfold-suite-v1')errors.push('schema_invalid');
 if(suite.certification!=='solver-verified')errors.push('certification_not_solver_verified');
 if(suite.game!=='NLHE'||suite.format!=='MTT'||suite.mode!=='cEV')errors.push('game_format_mode_invalid');
 if(suite.node!=='blind_vs_blind')errors.push('node_invalid');
 const tableSize=Number(suite.tableSize);if(![6,7,8,9].includes(tableSize))errors.push('table_size_invalid');
 const cv=validatePreflopContext(suite.preflopContext||{});if(!cv.valid)errors.push(...cv.errors.map(x=>`context_${x}`));
 if(Number(suite?.preflopContext?.playersDealt)!==tableSize)errors.push('context_table_size_mismatch');
 if(!SHA.test(String(suite.snapshotSha256||'')))errors.push('snapshot_sha_invalid');
 const auditShas=Array.isArray(suite?.equityAudit?.snapshotShas)?suite.equityAudit.snapshotShas.map(x=>String(x).toLowerCase()):[];
 if(!auditShas.includes(String(suite.snapshotSha256||'').toLowerCase()))errors.push('snapshot_not_in_audit');
 if(suite?.equityAudit?.stability?.stable!==true)errors.push('audit_not_stable');
 const depths=[...(suite.depths||[])].map(Number);
 if(!depths.length||depths.some(x=>!(x>0)))errors.push('depths_invalid');
 const canonicalDepths=[...new Set(depths)].sort((a,b)=>a-b);
 if(json(depths)!==json(canonicalDepths))errors.push('depths_not_sorted_unique');
 const reports=suite.reports||[];
 if(reports.length!==canonicalDepths.length)errors.push(`report_count_mismatch:${reports.length}:${canonicalDepths.length}`);
 for(const d of canonicalDepths){const r=reports.find(x=>Number(x?.depthBB)===d);if(!r)errors.push(`report_missing:${d}`);else if(r.verificationReady!==true||r.solverConsensus!==true||r.equityStable!==true)errors.push(`report_not_verified:${d}`)}
 const packs=Array.isArray(suite.packs)?suite.packs:[];
 if(packs.length!==canonicalDepths.length*2)errors.push(`pack_count_mismatch:${packs.length}:${canonicalDepths.length*2}`);
 const seen=new Set();
 for(const p of packs){
  const d=Number(p?.depthBB),side=String(p?.side||'').toUpperCase(),key=`${d}|${side}`;
  if(seen.has(key))errors.push(`duplicate_pack:${key}`);seen.add(key);
  if(!canonicalDepths.includes(d))errors.push(`pack_depth_unknown:${d}`);
  if(!['SB','BB'].includes(side))errors.push(`pack_side_invalid:${side}`);
  const m=p?.meta||{};
  if(Number(m.stackDepthBB)!==d||m.depthPolicy!=='exact')errors.push(`pack_depth_meta_mismatch:${key}`);
  if(m.certification!=='solver-verified'||m.sourceType!=='internal-pushfold-solver')errors.push(`pack_certification_invalid:${key}`);
  if(m.node!=='blind_vs_blind'||Number(m.tableSize)!==tableSize)errors.push(`pack_route_invalid:${key}`);
  if(String(m.snapshotSha256||'').toLowerCase()!==String(suite.snapshotSha256||'').toLowerCase())errors.push(`pack_snapshot_mismatch:${key}`);
  if(m.contextPolicy!=='exact-preflop-forced'||!sameContext(m.preflopContext,suite.preflopContext))errors.push(`pack_context_mismatch:${key}`);
  if(side==='SB'){
   if(m.heroPosition!=='SB'||m.villainPosition!=='BB')errors.push(`pack_positions_invalid:${key}`);
   errors.push(...chartValidation(p.chart,new Set(['FOLD','ALLIN'])).map(x=>`${key}:${x}`));
  }else if(side==='BB'){
   if(m.heroPosition!=='BB'||m.villainPosition!=='SB')errors.push(`pack_positions_invalid:${key}`);
   errors.push(...chartValidation(p.chart,new Set(['FOLD','CALL'])).map(x=>`${key}:${x}`));
  }
 }
 for(const d of canonicalDepths)for(const side of ['SB','BB'])if(!seen.has(`${d}|${side}`))errors.push(`pack_missing:${d}|${side}`);
 if(requireHash){
  if(!SHA.test(String(suite.suiteSha256||'')))errors.push('suite_sha_invalid');
  else{const computed=pushFoldSuiteSha256(suite);if(computed.toLowerCase()!==String(suite.suiteSha256).toLowerCase())errors.push('suite_sha_mismatch')}
 }
 return{valid:errors.length===0,errors,computedSuiteSha256:pushFoldSuiteSha256(suite),depths:canonicalDepths,packCount:packs.length};
}

export function assertValidPushFoldSuite(suite,opts){const v=validatePushFoldSuite(suite,opts);if(!v.valid)throw new Error(`pushfold_suite_invalid:${v.errors.join(',')}`);return v}

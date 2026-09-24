import {validatePreflopContext} from './pack-context.js';
const POS=new Set(['UTG','UTG1','MP','LJ','HJ','CO','BTN','SB','BB']);
const MODES=new Set(['cEV','ICM']);
const NODES=new Set(['unopened','vs_open','vs_open_multiway','vs_3bet','vs_4bet_plus','blind_vs_blind','reshove']);
const CERT=new Set(['reference-only','solver-derived','solver-verified','audited']);
const POLICIES=new Set(['exact','band']);
const CONTEXT_POLICIES=new Set(['generic','exact-preflop-forced']);
const SHA=/^[a-f0-9]{64}$/i;
const finitePositive=v=>Number.isFinite(Number(v))&&Number(v)>0;

export function validatePackMeta(meta={}){
 const errors=[];
 if(meta.game!=='NLHE')errors.push('game_must_be_NLHE');
 if(meta.format!=='MTT')errors.push('format_must_be_MTT');
 if(!MODES.has(meta.mode))errors.push('mode_invalid');
 if(![6,7,8,9].includes(Number(meta.tableSize)))errors.push('table_size_invalid');
 if(!finitePositive(meta.stackDepthBB))errors.push('stack_depth_bb_missing_or_invalid');
 const anchor=Number(meta.stackDepthBB),policy=String(meta.depthPolicy||'exact');
 if(!POLICIES.has(policy))errors.push('depth_policy_invalid');
 if(policy==='exact'){
  if(meta.minEffectiveBB!=null&&Number(meta.minEffectiveBB)!==anchor)errors.push('exact_depth_min_must_equal_anchor');
  if(meta.maxEffectiveBB!=null&&Number(meta.maxEffectiveBB)!==anchor)errors.push('exact_depth_max_must_equal_anchor');
 }else if(finitePositive(anchor)){
  if(!finitePositive(meta.minEffectiveBB)||!finitePositive(meta.maxEffectiveBB))errors.push('band_bounds_missing');
  else{
   const min=Number(meta.minEffectiveBB),max=Number(meta.maxEffectiveBB);
   if(min>max)errors.push('band_bounds_reversed');
   if(anchor<min||anchor>max)errors.push('stack_depth_outside_band');
  }
 }
 if(!NODES.has(meta.node))errors.push('node_invalid');
 if(!POS.has(meta.heroPosition))errors.push('hero_position_invalid');
 if(meta.villainPosition&&meta.villainPosition!=='*'&&!POS.has(meta.villainPosition))errors.push('villain_position_invalid');
 if(!String(meta.source||'').trim())errors.push('source_missing');
 if(!String(meta.sourceType||'').trim())errors.push('source_type_missing');
 if(!String(meta.referenceDate||'').trim())errors.push('reference_date_missing');
 if(!CERT.has(meta.certification))errors.push('certification_invalid');
 if(meta.snapshotSha256&&!SHA.test(meta.snapshotSha256))errors.push('snapshot_sha256_invalid');
 if(!Array.isArray(meta.actionSet)||!meta.actionSet.length)errors.push('action_set_missing');
 if(meta.mode==='ICM'&&!String(meta.icmStage||'').trim())errors.push('icm_stage_missing');
 const contextPolicy=String(meta.contextPolicy||'generic');
 if(!CONTEXT_POLICIES.has(contextPolicy))errors.push('context_policy_invalid');
 if(contextPolicy==='exact-preflop-forced'){
  const c=validatePreflopContext(meta.preflopContext||{});for(const e of c.errors)errors.push(`preflop_context_${e}`);
 }
 if(String(meta.sourceType)==='internal-pushfold-solver'&&contextPolicy!=='exact-preflop-forced')errors.push('pushfold_solver_requires_exact_context');
 return{valid:errors.length===0,errors};
}

export function assertPackMeta(meta){
 const v=validatePackMeta(meta);if(!v.valid)throw new Error(`strategy_pack_invalid:${v.errors.join(',')}`);return true;
}

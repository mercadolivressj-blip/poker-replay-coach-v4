const POS=new Set(['UTG','UTG1','MP','LJ','HJ','CO','BTN','SB','BB']);
const MODES=new Set(['cEV','ICM']);
const NODES=new Set(['unopened','vs_open','vs_open_multiway','vs_3bet','vs_4bet_plus','blind_vs_blind','reshove']);
const CERT=new Set(['reference-only','solver-derived','solver-verified','audited']);
const SHA=/^[a-f0-9]{64}$/i;

export function validatePackMeta(meta={}){
 const errors=[];
 if(meta.game!=='NLHE')errors.push('game_must_be_NLHE');
 if(meta.format!=='MTT')errors.push('format_must_be_MTT');
 if(!MODES.has(meta.mode))errors.push('mode_invalid');
 if(![6,7,8,9].includes(Number(meta.tableSize)))errors.push('table_size_invalid');
 if(!String(meta.stackBucket||'').trim())errors.push('stack_bucket_missing');
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
 return{valid:errors.length===0,errors};
}

export function assertPackMeta(meta){
 const v=validatePackMeta(meta);if(!v.valid)throw new Error(`strategy_pack_invalid:${v.errors.join(',')}`);return true;
}

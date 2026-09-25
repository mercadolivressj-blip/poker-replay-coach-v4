const finite=(v)=>typeof v==='number'&&Number.isFinite(v);
const upper=(v)=>String(v??'').trim().toUpperCase();

function normalizeRow(row={},metadata={}){
  const evByAction={};
  for(const [action,value] of Object.entries(row.evByAction||{})) if(finite(value)) evByAction[upper(action)]=value;
  return {
    fingerprint:String(row.fingerprint||''),
    oracleId:String(row.oracleId||metadata.oracleId||metadata.artifactId||'artifact-oracle'),
    source:String(row.source||metadata.source||'offline-artifact'),
    family:String(row.family||metadata.family||metadata.source||'offline-artifact'),
    action:upper(row.action),
    confidence:finite(row.confidence)?row.confidence:(finite(metadata.confidence)?metadata.confidence:1),
    domain:row.domain||metadata.domain||null,
    evByAction,
    artifactId:String(metadata.artifactId||'unknown-artifact'),
    artifactVersion:String(metadata.artifactVersion||'unversioned'),
    solvedAt:row.solvedAt||metadata.solvedAt||null,
    notes:Array.isArray(row.notes)?row.notes.map(String):[],
  };
}

export function createOracleArtifactIndex(artifact={}){
  const metadata=artifact?.metadata&&typeof artifact.metadata==='object'?artifact.metadata:{};
  const rows=Array.isArray(artifact?.rows)?artifact.rows:[];
  if(!metadata.artifactId) throw new TypeError('oracle artifact metadata.artifactId is required');
  if(!metadata.artifactVersion) throw new TypeError('oracle artifact metadata.artifactVersion is required');
  if(!metadata.family) throw new TypeError('oracle artifact metadata.family is required');
  if(!metadata.domain) throw new TypeError('oracle artifact metadata.domain is required');

  const byFingerprint=new Map();
  const errors=[];
  for(let i=0;i<rows.length;i++){
    const normalized=normalizeRow(rows[i],metadata);
    const rowErrors=[];
    if(!normalized.fingerprint) rowErrors.push('fingerprint_missing');
    if(!normalized.action) rowErrors.push('action_missing');
    if(Object.keys(normalized.evByAction).length<2) rowErrors.push('ev_coverage_insufficient');
    if(!finite(normalized.confidence)||normalized.confidence<0||normalized.confidence>1) rowErrors.push('confidence_invalid');
    if(normalized.fingerprint&&byFingerprint.has(normalized.fingerprint)) rowErrors.push('duplicate_fingerprint');
    if(rowErrors.length){errors.push({row:i,reasons:rowErrors});continue;}
    byFingerprint.set(normalized.fingerprint,Object.freeze(normalized));
  }

  return {
    version:'cash-pro-lab-oracle-artifact-index-v1',
    metadata:{...metadata},
    rowCount:rows.length,
    indexedCount:byFingerprint.size,
    rejectedCount:errors.length,
    errors,
    has:fingerprint=>byFingerprint.has(String(fingerprint||'')),
    get:fingerprint=>byFingerprint.get(String(fingerprint||''))||null,
  };
}

export function createArtifactOracleProvider(artifacts=[]){
  const indices=(Array.isArray(artifacts)?artifacts:[]).map(createOracleArtifactIndex);
  return async function artifactOracleProvider(node={}){
    const fingerprint=String(node.fingerprint||'');
    if(!fingerprint) return [];
    const out=[];
    for(const index of indices){
      const row=index.get(fingerprint);
      if(row) out.push({...row});
    }
    return out;
  };
}

export function summarizeOracleArtifacts(artifacts=[]){
  const indices=(Array.isArray(artifacts)?artifacts:[]).map(createOracleArtifactIndex);
  return {
    version:'cash-pro-lab-oracle-artifact-summary-v1',
    artifacts:indices.length,
    rows:indices.reduce((s,x)=>s+x.rowCount,0),
    indexed:indices.reduce((s,x)=>s+x.indexedCount,0),
    rejected:indices.reduce((s,x)=>s+x.rejectedCount,0),
    families:[...new Set(indices.map(x=>String(x.metadata.family)))],
    artifactIds:indices.map(x=>String(x.metadata.artifactId)),
  };
}

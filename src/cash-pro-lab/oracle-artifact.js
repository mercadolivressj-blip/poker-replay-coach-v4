const finite=(v)=>typeof v==='number'&&Number.isFinite(v);
const upper=(v)=>String(v??'').trim().toUpperCase();

function normalizeNumericMap(input={},keyTransform=x=>String(x)){
  const out={};
  for(const [key,value] of Object.entries(input||{})) if(finite(value)) out[keyTransform(key)]=value;
  return out;
}

function normalizeRow(row={},metadata={}){
  const evByAction=normalizeNumericMap(row.evByAction,upper);
  const evByChoice=normalizeNumericMap(row.evByChoice,String);
  const strategyByChoice=normalizeNumericMap(row.strategyByChoice,String);
  return {
    fingerprint:String(row.fingerprint||''),
    fingerprintVersion:String(row.fingerprintVersion||metadata.fingerprintVersion||''),
    oracleId:String(row.oracleId||metadata.oracleId||metadata.artifactId||'artifact-oracle'),
    source:String(row.source||metadata.source||'offline-artifact'),
    family:String(row.family||metadata.family||metadata.source||'offline-artifact'),
    action:upper(row.action),
    choiceId:String(row.choiceId||''),
    confidence:finite(row.confidence)?row.confidence:(finite(metadata.confidence)?metadata.confidence:1),
    domain:row.domain||metadata.domain||null,
    evByAction,
    evByChoice,
    strategyByChoice:Object.keys(strategyByChoice).length?strategyByChoice:null,
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
  if(!metadata.fingerprintVersion) throw new TypeError('oracle artifact metadata.fingerprintVersion is required');

  const byFingerprint=new Map();
  const errors=[];
  for(let i=0;i<rows.length;i++){
    const normalized=normalizeRow(rows[i],metadata);
    const rowErrors=[];
    if(!normalized.fingerprint) rowErrors.push('fingerprint_missing');
    if(normalized.fingerprintVersion!==String(metadata.fingerprintVersion)) rowErrors.push('fingerprint_version_mismatch');
    if(!normalized.choiceId&&!normalized.action) rowErrors.push('decision_missing');
    const choiceCoverage=Object.keys(normalized.evByChoice).length;
    const actionCoverage=Object.keys(normalized.evByAction).length;
    if(Math.max(choiceCoverage,actionCoverage)<2) rowErrors.push('ev_coverage_insufficient');
    if(!finite(normalized.confidence)||normalized.confidence<0||normalized.confidence>1) rowErrors.push('confidence_invalid');
    if(normalized.fingerprint&&byFingerprint.has(normalized.fingerprint)) rowErrors.push('duplicate_fingerprint');
    if(rowErrors.length){errors.push({row:i,reasons:rowErrors});continue;}
    byFingerprint.set(normalized.fingerprint,Object.freeze(normalized));
  }

  return {
    version:'cash-pro-lab-oracle-artifact-index-v2',
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
    const fingerprintVersion=String(node.fingerprintVersion||'');
    if(!fingerprint||!fingerprintVersion) return [];
    const out=[];
    for(const index of indices){
      if(String(index.metadata.fingerprintVersion)!==fingerprintVersion) continue;
      const row=index.get(fingerprint);
      if(row) out.push({...row});
    }
    return out;
  };
}

export function summarizeOracleArtifacts(artifacts=[]){
  const indices=(Array.isArray(artifacts)?artifacts:[]).map(createOracleArtifactIndex);
  return {
    version:'cash-pro-lab-oracle-artifact-summary-v2',
    artifacts:indices.length,
    rows:indices.reduce((s,x)=>s+x.rowCount,0),
    indexed:indices.reduce((s,x)=>s+x.indexedCount,0),
    rejected:indices.reduce((s,x)=>s+x.rejectedCount,0),
    families:[...new Set(indices.map(x=>String(x.metadata.family)))],
    fingerprintVersions:[...new Set(indices.map(x=>String(x.metadata.fingerprintVersion)))],
    artifactIds:indices.map(x=>String(x.metadata.artifactId)),
  };
}

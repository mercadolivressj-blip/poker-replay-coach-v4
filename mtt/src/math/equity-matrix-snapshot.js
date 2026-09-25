import {createHash} from 'node:crypto';
import {normalizeHandClass} from '../core/hand-class.js';

const SHA=/^[a-f0-9]{64}$/i;
const round=(x,d=12)=>Number(Number(x).toFixed(d));

function canonicalHands(hands=[]){
 const out=[...new Set(hands.map(normalizeHandClass).filter(Boolean))];
 if(!out.length)throw new Error('equity_snapshot_hands_empty');
 return out.sort();
}

function canonicalMatrix(matrix,hands){
 const out={};
 for(const a of hands){
  out[a]={};
  for(const b of hands){
   const v=Number(matrix?.[a]?.[b]);
   if(!Number.isFinite(v))throw new Error(`equity_snapshot_missing:${a}:${b}`);
   if(v<0||v>1)throw new Error(`equity_snapshot_out_of_range:${a}:${b}`);
   out[a][b]=round(v);
  }
 }
 return out;
}

export function validateEquityMatrix({matrix,hands,tolerance=1e-9}={}){
 const hs=canonicalHands(hands),errors=[];
 for(const a of hs){
  const d=Number(matrix?.[a]?.[a]);
  if(!Number.isFinite(d)||Math.abs(d-.5)>tolerance)errors.push(`diagonal:${a}`);
 }
 for(let i=0;i<hs.length;i++)for(let j=i+1;j<hs.length;j++){
  const a=hs[i],b=hs[j],x=Number(matrix?.[a]?.[b]),y=Number(matrix?.[b]?.[a]);
  if(!Number.isFinite(x)||!Number.isFinite(y))errors.push(`missing_pair:${a}:${b}`);
  else if(Math.abs((x+y)-1)>tolerance)errors.push(`asymmetry:${a}:${b}`);
 }
 return{valid:errors.length===0,errors,hands:hs.length};
}

export function equitySnapshotPayload({matrix,hands,seed,iterationsPerPair,evaluatorVersion='fast-holdem-evaluator',generatorVersion='equity-matrix-snapshot-v1'}={}){
 const hs=canonicalHands(hands);
 const v=validateEquityMatrix({matrix,hands:hs});if(!v.valid)throw new Error(`equity_snapshot_invalid:${v.errors.join(',')}`);
 const iterations=Math.floor(Number(iterationsPerPair));if(!(iterations>0))throw new Error('equity_snapshot_iterations_invalid');
 const s=String(seed??'').trim();if(!s)throw new Error('equity_snapshot_seed_missing');
 return{schema:'ssj-mtt-equity-matrix-v1',generatorVersion,evaluatorVersion,seed:s,iterationsPerPair:iterations,hands:hs,matrix:canonicalMatrix(matrix,hs)};
}

export function canonicalSnapshotJson(payload){return JSON.stringify(payload)}
export function snapshotSha256(payload){return createHash('sha256').update(canonicalSnapshotJson(payload)).digest('hex')}

export function buildEquityMatrixSnapshot(input={}){
 const payload=equitySnapshotPayload(input),sha256=snapshotSha256(payload);
 return{...payload,sha256};
}

export function verifyEquityMatrixSnapshot(snapshot={}){
 const {sha256,...rest}=snapshot||{};
 const errors=[];
 if(!SHA.test(String(sha256||'')))errors.push('sha256_format');
 let payload=null,computed=null;
 try{payload=equitySnapshotPayload(rest);computed=snapshotSha256(payload)}catch(e){errors.push(String(e.message||e))}
 if(computed&&String(sha256).toLowerCase()!==computed.toLowerCase())errors.push('sha256_mismatch');
 return{valid:errors.length===0,errors,computedSha256:computed};
}

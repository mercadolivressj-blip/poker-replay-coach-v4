import { createDecisionNode, proveDecisionNode } from './decision-node.js';
import { buildOracleConsensus } from './oracle-consensus.js';
import { auditDecisionEV } from './ev-auditor.js';

const upper=(v)=>String(v??'').trim().toUpperCase();

function freezeClone(value){
  if(Array.isArray(value)) return Object.freeze(value.map(freezeClone));
  if(value&&typeof value==='object'){
    const out={};for(const [k,v] of Object.entries(value)) out[k]=freezeClone(v);
    return Object.freeze(out);
  }
  return value;
}

function legalMix(mix,legal){
  if(!mix||typeof mix!=='object'||Array.isArray(mix)) return null;
  let total=0,count=0;const out={};
  for(const [rawAction,rawWeight] of Object.entries(mix)){
    const action=upper(rawAction),weight=Number(rawWeight);
    if(!legal.includes(action)||!Number.isFinite(weight)||weight<0) return null;
    if(weight===0) continue;
    out[action]=weight;total+=weight;count++;
  }
  if(count<2||Math.abs(total-1)>1e-6) return null;
  return out;
}

export async function evaluateCashDecision({input,node,student,oracles=[],proofOptions={},consensusOptions={}}={}){
  const canonical=node?.schemaVersion==='cash-pro-lab-node-v1'?node:createDecisionNode(input||{});
  const proof=proveDecisionNode(canonical,proofOptions);
  if(!proof.ok){
    return {version:'cash-pro-lab-evaluation-v1',status:'BLOCKED',phase:'UNDERSTANDING_PROOF',node:canonical,proof,student:null,consensus:null,audit:null};
  }
  if(typeof student!=='function') throw new TypeError('student must be a function');

  let studentResult;
  try{
    studentResult=await student(freezeClone(canonical));
  }catch(error){
    return {version:'cash-pro-lab-evaluation-v1',status:'BLOCKED',phase:'STUDENT_RUNTIME',node:canonical,proof,student:{error:String(error?.message||error)},consensus:null,audit:null};
  }
  if(studentResult?.blocked===true){
    return {version:'cash-pro-lab-evaluation-v1',status:'BLOCKED',phase:'STUDENT_OUTPUT',node:canonical,proof,student:studentResult,consensus:null,audit:null};
  }

  const studentAction=upper(studentResult?.action);
  const actionMix=legalMix(studentResult?.actionMix,canonical.legalActions);
  if(!actionMix&&!canonical.legalActions.includes(studentAction)){
    return {version:'cash-pro-lab-evaluation-v1',status:'BLOCKED',phase:'STUDENT_LEGALITY',node:canonical,proof,student:{...studentResult,action:studentAction},consensus:null,audit:null};
  }

  const consensus=buildOracleConsensus(canonical,oracles,consensusOptions);
  if(consensus.blocked){
    return {version:'cash-pro-lab-evaluation-v1',status:'BLOCKED',phase:'TEACHER_CONSENSUS',node:canonical,proof,student:{...studentResult,action:studentAction||null,actionMix},consensus,audit:null};
  }

  const normalizedStudent={...studentResult,action:studentAction||null,actionMix};
  const audit=auditDecisionEV(canonical,normalizedStudent,consensus);
  if(audit.blocked){
    return {version:'cash-pro-lab-evaluation-v1',status:'BLOCKED',phase:'EV_AUDIT',node:canonical,proof,student:normalizedStudent,consensus,audit};
  }

  return {
    version:'cash-pro-lab-evaluation-v1',
    status:'STUDIED',
    phase:'COMPLETE',
    node:canonical,
    proof,
    student:normalizedStudent,
    consensus,
    audit,
    lesson:{
      fingerprint:canonical.fingerprint,
      highImpact:audit.highImpact,
      studentAction:audit.studentAction,
      studentActionMix:audit.studentActionMix,
      teacherAction:audit.bestAction,
      evLossBB:audit.evLossBB,
      severity:audit.severity,
      needsReview:audit.severity==='major'||audit.severity==='catastrophic'||audit.highImpact,
    },
  };
}

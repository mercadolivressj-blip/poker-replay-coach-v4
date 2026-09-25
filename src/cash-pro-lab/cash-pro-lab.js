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
  const studentAction=upper(studentResult?.action);
  if(!canonical.legalActions.includes(studentAction)){
    return {version:'cash-pro-lab-evaluation-v1',status:'BLOCKED',phase:'STUDENT_LEGALITY',node:canonical,proof,student:{...studentResult,action:studentAction},consensus:null,audit:null};
  }

  const consensus=buildOracleConsensus(canonical,oracles,consensusOptions);
  if(consensus.blocked){
    return {version:'cash-pro-lab-evaluation-v1',status:'BLOCKED',phase:'TEACHER_CONSENSUS',node:canonical,proof,student:{...studentResult,action:studentAction},consensus,audit:null};
  }

  const audit=auditDecisionEV(canonical,{...studentResult,action:studentAction},consensus);
  if(audit.blocked){
    return {version:'cash-pro-lab-evaluation-v1',status:'BLOCKED',phase:'EV_AUDIT',node:canonical,proof,student:{...studentResult,action:studentAction},consensus,audit};
  }

  return {
    version:'cash-pro-lab-evaluation-v1',
    status:'STUDIED',
    phase:'COMPLETE',
    node:canonical,
    proof,
    student:{...studentResult,action:studentAction},
    consensus,
    audit,
    lesson:{
      fingerprint:canonical.fingerprint,
      highImpact:audit.highImpact,
      studentAction:audit.studentAction,
      teacherAction:audit.bestAction,
      evLossBB:audit.evLossBB,
      severity:audit.severity,
      needsReview:audit.severity==='major'||audit.severity==='catastrophic'||audit.highImpact,
    },
  };
}

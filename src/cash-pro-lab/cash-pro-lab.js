import { createDecisionNode, proveDecisionNode, resolveLegalChoice } from './decision-node.js';
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

function normalizeChoiceMix(mix,node){
  if(!mix||typeof mix!=='object'||Array.isArray(mix)) return null;
  const ids=new Set((node.legalOptions||[]).map(o=>o.id));
  let total=0,count=0;const out={};
  for(const [id,rawWeight] of Object.entries(mix)){
    const weight=Number(rawWeight);
    if(!ids.has(id)||!Number.isFinite(weight)||weight<0) return null;
    if(weight===0) continue;
    out[id]=weight;total+=weight;count++;
  }
  if(count<2||Math.abs(total-1)>1e-6) return null;
  return out;
}

function normalizeActionMix(mix,node){
  if(!mix||typeof mix!=='object'||Array.isArray(mix)) return null;
  let total=0,count=0;const out={};
  for(const [rawAction,rawWeight] of Object.entries(mix)){
    const action=upper(rawAction),weight=Number(rawWeight);
    if(!Number.isFinite(weight)||weight<0) return null;
    if(weight===0) continue;
    const candidates=(node.legalOptions||[]).filter(o=>o.action===action);
    if(candidates.length!==1) return null;
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

  const explicitChoiceMix=normalizeChoiceMix(studentResult?.choiceMix,canonical);
  const actionMix=explicitChoiceMix?null:normalizeActionMix(studentResult?.actionMix,canonical);
  const choice=explicitChoiceMix||actionMix?null:resolveLegalChoice(canonical,studentResult);
  if(!explicitChoiceMix&&!actionMix&&!choice){
    const action=upper(studentResult?.action);
    const sameAction=(canonical.legalOptions||[]).filter(o=>o.action===action);
    const phase=sameAction.length>1?'STUDENT_SIZING':'STUDENT_LEGALITY';
    return {version:'cash-pro-lab-evaluation-v1',status:'BLOCKED',phase,node:canonical,proof,student:{...studentResult,action},consensus:null,audit:null};
  }

  const consensus=buildOracleConsensus(canonical,oracles,consensusOptions);
  if(consensus.blocked){
    return {version:'cash-pro-lab-evaluation-v1',status:'BLOCKED',phase:'TEACHER_CONSENSUS',node:canonical,proof,student:{...studentResult,choiceId:choice?.id??studentResult?.choiceId??null,choiceMix:explicitChoiceMix,actionMix},consensus,audit:null};
  }

  const normalizedStudent={
    ...studentResult,
    action:choice?.action??upper(studentResult?.action)||null,
    choiceId:choice?.id??studentResult?.choiceId??null,
    choiceMix:explicitChoiceMix,
    actionMix,
  };
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
      studentChoiceId:audit.studentChoiceId,
      studentChoiceMix:audit.studentChoiceMix,
      teacherAction:audit.bestAction,
      teacherChoiceId:audit.bestChoiceId,
      evLossBB:audit.evLossBB,
      severity:audit.severity,
      needsReview:audit.severity==='major'||audit.severity==='catastrophic'||audit.highImpact,
    },
  };
}

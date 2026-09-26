import { evaluateCashDecision } from './cash-pro-lab.js';
import { summarizeEVAudits } from './ev-auditor.js';
import { buildLeakReport } from './leak-report.js';

export async function runCashClassroom({nodes=[],student,oracleProvider,proofOptions={},consensusOptions={}}={}){
  if(!Array.isArray(nodes)) throw new TypeError('nodes must be an array');
  if(typeof student!=='function') throw new TypeError('student must be a function');
  if(typeof oracleProvider!=='function') throw new TypeError('oracleProvider must be a function');

  const evaluations=[];
  const blockedByPhase={};
  const strictConsensusOptions={...consensusOptions,requireDomainDescriptor:true};
  for(const node of nodes){
    let oracles=[];
    try{
      const provided=await oracleProvider(node);
      oracles=Array.isArray(provided)?provided:[];
    }catch(error){
      const row={
        version:'cash-pro-lab-evaluation-v1',status:'BLOCKED',phase:'ORACLE_PROVIDER',node,
        proof:null,student:null,consensus:null,audit:null,error:String(error?.message||error),
      };
      evaluations.push(row);
      blockedByPhase[row.phase]=(blockedByPhase[row.phase]||0)+1;
      continue;
    }
    const row=await evaluateCashDecision({node,student,oracles,proofOptions,consensusOptions:strictConsensusOptions});
    evaluations.push(row);
    if(row.status==='BLOCKED') blockedByPhase[row.phase]=(blockedByPhase[row.phase]||0)+1;
  }

  const studied=evaluations.filter(r=>r.status==='STUDIED');
  const audits=studied.map(r=>r.audit).filter(Boolean);
  return {
    version:'cash-pro-lab-classroom-v1',
    totalNodes:nodes.length,
    studiedNodes:studied.length,
    blockedNodes:evaluations.length-studied.length,
    blockedByPhase,
    evSummary:summarizeEVAudits(audits),
    leakReport:buildLeakReport(evaluations),
    evaluations,
  };
}

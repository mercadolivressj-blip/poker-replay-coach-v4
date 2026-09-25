import { evaluateCashDecision } from './cash-pro-lab.js';
import { summarizeEVAudits } from './ev-auditor.js';
import { buildLeakReport } from './leak-report.js';

const STRICT_CONSENSUS={
  requireDomainDescriptor:true,
  requireIndependentFamilies:true,
  maxEvSpreadBB:0.75,
  minActionAgreement:0.55,
};

function mergeCounts(target={},source={}){
  for(const [key,value] of Object.entries(source||{})) target[key]=(target[key]||0)+(Number(value)||0);
  return target;
}

export async function runCurriculumStream({
  tickets,
  nodeFactory,
  student,
  oracleProvider,
  proofOptions={},
  consensusOptions={},
  split='train',
  maxTickets=Infinity,
  checkpointEvery=1000,
  onCheckpoint=null,
  retainEvaluations=5000,
}={}){
  if(!tickets||typeof tickets[Symbol.iterator]!=='function') throw new TypeError('tickets must be iterable');
  if(typeof nodeFactory!=='function') throw new TypeError('nodeFactory must be a function');
  if(typeof student!=='function') throw new TypeError('student must be a function');
  if(typeof oracleProvider!=='function') throw new TypeError('oracleProvider must be a function');
  if(!(maxTickets>0)) throw new TypeError('maxTickets must be above zero');
  const resolvedConsensusOptions={...STRICT_CONSENSUS,...consensusOptions};

  let seen=0,processed=0,studied=0,blocked=0,nodeFactoryBlocked=0,oracleProviderBlocked=0;
  const blockedByPhase={};
  const audits=[];
  const retained=[];

  for(const ticket of tickets){
    if(seen>=maxTickets) break;
    seen++;
    if(split&&ticket?.split!==split) continue;

    let node;
    try{
      node=await nodeFactory(ticket);
    }catch(error){
      nodeFactoryBlocked++;
      blocked++;
      blockedByPhase.NODE_FACTORY=(blockedByPhase.NODE_FACTORY||0)+1;
      if(retained.length<retainEvaluations) retained.push({status:'BLOCKED',phase:'NODE_FACTORY',ticket,error:String(error?.message||error)});
      continue;
    }
    if(!node){
      nodeFactoryBlocked++;
      blocked++;
      blockedByPhase.NODE_FACTORY=(blockedByPhase.NODE_FACTORY||0)+1;
      if(retained.length<retainEvaluations) retained.push({status:'BLOCKED',phase:'NODE_FACTORY',ticket,error:'node_not_constructed'});
      continue;
    }

    let oracles;
    try{
      oracles=await oracleProvider(node,ticket);
      if(!Array.isArray(oracles)) oracles=[];
    }catch(error){
      oracleProviderBlocked++;
      blocked++;
      blockedByPhase.ORACLE_PROVIDER=(blockedByPhase.ORACLE_PROVIDER||0)+1;
      if(retained.length<retainEvaluations) retained.push({status:'BLOCKED',phase:'ORACLE_PROVIDER',ticket,node,error:String(error?.message||error)});
      continue;
    }

    const evaluation=await evaluateCashDecision({node,student,oracles,proofOptions,consensusOptions:resolvedConsensusOptions});
    processed++;
    if(evaluation.status==='STUDIED'){
      studied++;
      if(evaluation.audit) audits.push(evaluation.audit);
    }else{
      blocked++;
      blockedByPhase[evaluation.phase]=(blockedByPhase[evaluation.phase]||0)+1;
    }
    if(retained.length<retainEvaluations) retained.push({...evaluation,ticket});

    if(Number.isInteger(checkpointEvery)&&checkpointEvery>0&&processed%checkpointEvery===0&&typeof onCheckpoint==='function'){
      await onCheckpoint({version:'cash-pro-lab-scale-checkpoint-v1',seen,processed,studied,blocked,blockedByPhase:{...blockedByPhase},evSummary:summarizeEVAudits(audits)});
    }
  }

  return {
    version:'cash-pro-lab-scale-run-v1',
    requestedSplit:split,
    consensusOptions:resolvedConsensusOptions,
    ticketsSeen:seen,
    processedNodes:processed,
    studiedNodes:studied,
    blockedNodes:blocked,
    nodeFactoryBlocked,
    oracleProviderBlocked,
    blockedByPhase:mergeCounts({},blockedByPhase),
    evSummary:summarizeEVAudits(audits),
    leakReport:buildLeakReport(retained.filter(r=>r?.node)),
    retainedEvaluations:retained,
    retentionLimit:retainEvaluations,
    note:'This runner is bounded-memory orchestration. Ticket count is not equivalent to solver-certified studies; only STUDIED nodes passed proof, teacher-domain verification, teacher-disagreement gates and EV audit.',
  };
}

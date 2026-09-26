import { resolveLegalChoice } from './decision-node.js';

const finite=(v)=>typeof v==='number'&&Number.isFinite(v);
const upper=(v)=>String(v??'').trim().toUpperCase();

function severity(lossBB){
  if(!finite(lossBB)) return 'unknown';
  if(lossBB<0.02) return 'negligible';
  if(lossBB<0.10) return 'small';
  if(lossBB<0.50) return 'material';
  if(lossBB<2.00) return 'major';
  return 'catastrophic';
}

function legalOptions(node={}){
  return Array.isArray(node.legalOptions)&&node.legalOptions.length?node.legalOptions:(node.legalActions||[]).map(action=>({id:action,action}));
}

function parseChoiceMix(mix,options){
  if(!mix||typeof mix!=='object'||Array.isArray(mix)) return null;
  const ids=new Set(options.map(o=>o.id));
  const rows=[];let total=0;
  for(const [id,rawWeight] of Object.entries(mix)){
    const weight=Number(rawWeight);
    if(!ids.has(id)||!finite(weight)||weight<0) return null;
    if(weight===0) continue;
    rows.push([id,weight]);total+=weight;
  }
  if(rows.length<2||Math.abs(total-1)>1e-6) return null;
  return Object.fromEntries(rows);
}

function actionMixToChoiceMix(mix,node,options){
  if(!mix||typeof mix!=='object'||Array.isArray(mix)) return null;
  const out={};let total=0,count=0;
  for(const [rawAction,rawWeight] of Object.entries(mix)){
    const action=upper(rawAction),weight=Number(rawWeight);
    if(!finite(weight)||weight<0) return null;
    if(weight===0) continue;
    const candidates=options.filter(o=>upper(o.action)===action);
    if(candidates.length!==1) return null;
    out[candidates[0].id]=weight;total+=weight;count++;
  }
  if(count<2||Math.abs(total-1)>1e-6) return null;
  return out;
}

function evForChoice(consensus,id,option){
  const direct=consensus?.evByChoice?.[id];
  if(finite(direct)) return direct;
  const legacy=consensus?.evByAction?.[upper(option?.action)];
  return finite(legacy)?legacy:null;
}

export function auditDecisionEV(node={},studentResult={},consensus={}){
  if(consensus?.blocked) return {version:'cash-pro-lab-ev-audit-v1',blocked:true,reason:'oracle_consensus_blocked'};
  const options=legalOptions(node);
  const explicitMix=parseChoiceMix(studentResult?.choiceMix,options);
  const legacyMix=explicitMix?null:actionMixToChoiceMix(studentResult?.actionMix,node,options);
  const choiceMix=explicitMix||legacyMix;
  const choice=choiceMix?null:resolveLegalChoice(node,studentResult);
  if(!choiceMix&&!choice) return {version:'cash-pro-lab-ev-audit-v1',blocked:true,reason:'student_choice_illegal_or_ambiguous'};

  const bestChoiceId=consensus?.bestChoiceId||resolveLegalChoice(node,{action:consensus?.bestAction})?.id||null;
  const bestOption=options.find(o=>o.id===bestChoiceId)||null;
  const bestAction=consensus?.bestAction||upper(bestOption?.action);
  const bestEV=finite(consensus?.bestEV)?consensus.bestEV:evForChoice(consensus,bestChoiceId,bestOption);
  if(!finite(bestEV)||!bestChoiceId) return {version:'cash-pro-lab-ev-audit-v1',blocked:true,reason:'ev_missing'};

  let studentEV=null,studentAction=null,studentChoiceId=null,exactMatch=false;
  if(choiceMix){
    studentEV=0;
    for(const [id,w] of Object.entries(choiceMix)){
      const option=options.find(o=>o.id===id);
      const ev=evForChoice(consensus,id,option);
      if(!finite(ev)) return {version:'cash-pro-lab-ev-audit-v1',blocked:true,reason:'mixed_ev_missing'};
      studentEV+=ev*w;
    }
    studentAction='MIXED';
  }else{
    studentChoiceId=choice.id;
    studentAction=choice.action;
    studentEV=evForChoice(consensus,choice.id,choice);
    if(!finite(studentEV)) return {version:'cash-pro-lab-ev-audit-v1',blocked:true,reason:'ev_missing'};
    exactMatch=choice.id===bestChoiceId;
  }

  const evLossBB=Math.max(0,bestEV-studentEV);
  const evByChoice={};for(const option of options){const ev=evForChoice(consensus,option.id,option);evByChoice[option.id]=finite(ev)?ev:null;}
  return {
    version:'cash-pro-lab-ev-audit-v1',
    blocked:false,
    fingerprint:node.fingerprint??null,
    street:node.street??null,
    highImpact:consensus.highImpact===true,
    studentAction,
    studentChoiceId,
    studentChoiceMix:choiceMix,
    studentActionMix:studentResult?.actionMix??null,
    studentEV,
    bestChoiceId,
    bestAction,
    bestEV,
    evLossBB,
    severity:severity(evLossBB),
    exactMatch,
    consensusConfidence:consensus.confidence??0,
    oracleCount:consensus.eligibleCount??0,
    evByChoice,
    evByAction:{...(consensus.evByAction||{})},
  };
}

export function summarizeEVAudits(audits=[]){
  const rows=(Array.isArray(audits)?audits:[]).filter(a=>a&&!a.blocked&&finite(a.evLossBB));
  const totalEvLossBB=rows.reduce((s,a)=>s+a.evLossBB,0);
  const highImpact=rows.filter(a=>a.highImpact);
  const catastrophic=rows.filter(a=>a.severity==='catastrophic');
  const major=rows.filter(a=>a.severity==='major'||a.severity==='catastrophic');
  return {
    version:'cash-pro-lab-ev-summary-v1',
    decisions:rows.length,
    totalEvLossBB,
    avgEvLossBB:rows.length?totalEvLossBB/rows.length:null,
    highImpactDecisions:highImpact.length,
    highImpactEvLossBB:highImpact.reduce((s,a)=>s+a.evLossBB,0),
    majorErrors:major.length,
    catastrophicErrors:catastrophic.length,
    exactMatches:rows.filter(a=>a.exactMatch).length,
  };
}

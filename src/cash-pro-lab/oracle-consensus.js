import { isHighImpactNode } from './decision-node.js';
import { verifyOracleDomain } from './oracle-domain.js';

const finite=(v)=>typeof v==='number'&&Number.isFinite(v);
const upper=(v)=>String(v??'').trim().toUpperCase();
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));

function legalOptions(node={}){
  const rows=Array.isArray(node.legalOptions)&&node.legalOptions.length
    ? node.legalOptions
    : (node.legalActions||[]).map(action=>({id:action,action}));
  return rows.map(o=>({id:String(o.id),action:upper(o.action),amountBB:finite(o.amountBB)?o.amountBB:null,allIn:o.allIn===true}));
}

function actionMultiplicity(options=[]){
  const counts={};for(const o of options)counts[o.action]=(counts[o.action]||0)+1;return counts;
}

function normalizeOracle(row={},options=[]){
  const multiplicity=actionMultiplicity(options);
  const evByChoice={};
  for(const option of options){
    const direct=row?.evByChoice?.[option.id];
    const legacy=row?.evByAction?.[option.action];
    evByChoice[option.id]=finite(direct)?direct:(multiplicity[option.action]===1&&finite(legacy)?legacy:null);
  }
  const action=upper(row.action);
  let choiceId=String(row.choiceId||'');
  if(!choiceId&&action&&multiplicity[action]===1) choiceId=options.find(o=>o.action===action)?.id||'';
  return {
    oracleId:String(row.oracleId||row.source||'unknown'),
    source:String(row.source||row.oracleId||'unknown'),
    family:String(row.family||row.source||row.oracleId||'unknown'),
    action,
    choiceId,
    confidence:finite(row.confidence)?clamp(row.confidence,0,1):0,
    claimedDomainVerified:row.domainVerified===true,
    domain:row.domain??null,
    evByChoice,
    notes:Array.isArray(row.notes)?row.notes.map(String):[],
  };
}

function weightedAverage(values=[]){
  let num=0,den=0;
  for(const row of values){
    if(!finite(row.value)||!finite(row.weight)||row.weight<=0) continue;
    num+=row.value*row.weight;den+=row.weight;
  }
  return den>0?num/den:null;
}

function blockedBase({highImpact,reason,required,eligible,rejected,options,extra={}}){
  return {
    version:'cash-pro-lab-oracle-consensus-v1',blocked:true,highImpact,reason,required,
    eligibleCount:eligible.length,eligible,rejected,
    evByChoice:Object.fromEntries(options.map(o=>[o.id,null])),evByAction:{},bestChoiceId:null,bestAction:null,confidence:0,...extra,
  };
}

export function buildOracleConsensus(node={},oracleResults=[],config={}){
  const options=legalOptions(node);
  const legal=[...new Set(options.map(o=>o.action))];
  const multiplicity=actionMultiplicity(options);
  const sizingSensitive=Object.values(multiplicity).some(n=>n>1);
  const requireChoiceEV=config.requireChoiceEV===true||sizingSensitive;
  const normalized=(Array.isArray(oracleResults)?oracleResults:[]).map(r=>normalizeOracle(r,options));
  const rejected=[];
  const eligible=[];
  const minConfidence=config.minOracleConfidence??0.60;
  const requireDomainDescriptor=config.requireDomainDescriptor===true;

  for(const oracle of normalized){
    const reasons=[];
    const domainCheck=verifyOracleDomain(node,oracle.domain);
    const legacyAllowed=!requireDomainDescriptor&&oracle.claimedDomainVerified===true;
    if(!domainCheck.ok&&!legacyAllowed) reasons.push('domain_unverified',...domainCheck.reasons);
    if(oracle.confidence<minConfidence) reasons.push('confidence_too_low');
    if(oracle.choiceId&&!options.some(o=>o.id===oracle.choiceId)) reasons.push('oracle_choice_illegal');
    if(!oracle.choiceId&&(!oracle.action||!legal.includes(oracle.action))) reasons.push('oracle_action_illegal');
    const covered=options.filter(o=>finite(oracle.evByChoice[o.id]));
    if(covered.length<2) reasons.push(requireChoiceEV?'choice_ev_coverage_insufficient':'ev_coverage_insufficient');
    if(requireChoiceEV&&sizingSensitive&&!oracle.choiceId) reasons.push('oracle_sizing_choice_missing');
    const normalizedOracle={...oracle,domainVerified:domainCheck.ok,legacyDomainClaimUsed:legacyAllowed&&!domainCheck.ok,domainCheck};
    if(reasons.length) rejected.push({oracleId:oracle.oracleId,reasons:[...new Set(reasons)],domainCheck});
    else eligible.push(normalizedOracle);
  }

  const highImpact=isHighImpactNode(node);
  const minOracles=highImpact?(config.minHighImpactOracles??2):(config.minOracles??1);
  if(eligible.length<minOracles){
    return blockedBase({highImpact,reason:'insufficient_verified_oracles',required:minOracles,eligible,rejected,options,extra:{sizingSensitive,requireChoiceEV}});
  }

  if(highImpact&&config.requireIndependentFamilies===true){
    const families=[...new Set(eligible.map(o=>o.family).filter(Boolean))];
    const minFamilies=config.minHighImpactFamilies??2;
    if(families.length<minFamilies){
      return blockedBase({highImpact,reason:'insufficient_independent_oracles',required:minFamilies,eligible,rejected,options,extra:{families,sizingSensitive,requireChoiceEV}});
    }
  }

  const evByChoice={};
  const coverageByChoice={};
  const spreadByChoice={};
  for(const option of options){
    const values=eligible.filter(o=>finite(o.evByChoice[option.id])).map(o=>o.evByChoice[option.id]);
    const rows=eligible.filter(o=>finite(o.evByChoice[option.id])).map(o=>({value:o.evByChoice[option.id],weight:o.confidence}));
    evByChoice[option.id]=weightedAverage(rows);
    coverageByChoice[option.id]=rows.length;
    spreadByChoice[option.id]=values.length>=2?Math.max(...values)-Math.min(...values):0;
  }
  const candidates=options.filter(o=>finite(evByChoice[o.id]));
  if(candidates.length<2){
    return blockedBase({highImpact,reason:'consensus_ev_coverage_insufficient',required:minOracles,eligible,rejected,options,extra:{evByChoice,coverageByChoice,spreadByChoice,sizingSensitive,requireChoiceEV}});
  }

  const maxEvSpreadBB=finite(config.maxEvSpreadBB)?config.maxEvSpreadBB:Infinity;
  const divergentChoices=candidates.filter(o=>spreadByChoice[o.id]>maxEvSpreadBB).map(o=>o.id);
  if(divergentChoices.length){
    const divergentActions=[...new Set(divergentChoices.map(id=>options.find(o=>o.id===id)?.action).filter(Boolean))];
    return blockedBase({highImpact,reason:'oracle_ev_disagreement',required:minOracles,eligible,rejected,options,extra:{evByChoice,coverageByChoice,spreadByChoice,divergentChoices,divergentActions,maxEvSpreadBB,sizingSensitive,requireChoiceEV}});
  }

  candidates.sort((a,b)=>evByChoice[b.id]-evByChoice[a.id]);
  const bestChoice=candidates[0];
  const bestChoiceId=bestChoice.id;
  const bestAction=bestChoice.action;
  const bestEV=evByChoice[bestChoiceId];
  const secondEV=evByChoice[candidates[1].id];
  const marginBB=bestEV-secondEV;
  const agreementWeight=eligible.reduce((sum,o)=>sum+((o.choiceId===bestChoiceId||(!sizingSensitive&&o.action===bestAction))?o.confidence:0),0);
  const totalWeight=eligible.reduce((sum,o)=>sum+o.confidence,0);
  const actionAgreement=totalWeight>0?agreementWeight/totalWeight:0;
  const minActionAgreement=finite(config.minActionAgreement)?config.minActionAgreement:0;
  if(actionAgreement<minActionAgreement){
    return blockedBase({highImpact,reason:'oracle_action_disagreement',required:minOracles,eligible,rejected,options,extra:{evByChoice,coverageByChoice,spreadByChoice,bestChoiceId,bestAction,bestEV,secondEV,marginBB,actionAgreement,minActionAgreement,sizingSensitive,requireChoiceEV}});
  }

  const evByAction={};
  for(const action of legal){
    const values=options.filter(o=>o.action===action&&finite(evByChoice[o.id])).map(o=>evByChoice[o.id]);
    evByAction[action]=values.length?Math.max(...values):null;
  }
  const confidence=clamp((actionAgreement*0.55)+Math.min(1,Math.max(0,marginBB)/0.50)*0.45,0,1);

  return {
    version:'cash-pro-lab-oracle-consensus-v1',
    blocked:false,
    highImpact,
    sizingSensitive,
    requireChoiceEV,
    eligibleCount:eligible.length,
    eligible,
    rejected,
    evByChoice,
    evByAction,
    coverageByChoice,
    spreadByChoice,
    bestChoiceId,
    bestAction,
    bestEV,
    secondEV,
    marginBB,
    actionAgreement,
    confidence,
  };
}

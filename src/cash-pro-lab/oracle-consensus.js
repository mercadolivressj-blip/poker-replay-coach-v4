import { isHighImpactNode } from './decision-node.js';
import { verifyOracleDomain } from './oracle-domain.js';

const finite=(v)=>typeof v==='number'&&Number.isFinite(v);
const upper=(v)=>String(v??'').trim().toUpperCase();
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));

function normalizeOracle(row={},legalActions=[]){
  const evByAction={};
  for(const action of legalActions){
    const value=row?.evByAction?.[action];
    evByAction[action]=finite(value)?value:null;
  }
  return {
    oracleId:String(row.oracleId||row.source||'unknown'),
    source:String(row.source||row.oracleId||'unknown'),
    family:String(row.family||row.source||row.oracleId||'unknown'),
    action:upper(row.action),
    confidence:finite(row.confidence)?clamp(row.confidence,0,1):0,
    claimedDomainVerified:row.domainVerified===true,
    domain:row.domain??null,
    evByAction,
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

function blockedBase({highImpact,reason,required,eligible,rejected,legal,extra={}}){
  return {
    version:'cash-pro-lab-oracle-consensus-v1',blocked:true,highImpact,reason,required,
    eligibleCount:eligible.length,eligible,rejected,
    evByAction:Object.fromEntries(legal.map(a=>[a,null])),bestAction:null,confidence:0,...extra,
  };
}

export function buildOracleConsensus(node={},oracleResults=[],options={}){
  const legal=Array.isArray(node.legalActions)?node.legalActions:[];
  const normalized=(Array.isArray(oracleResults)?oracleResults:[]).map(r=>normalizeOracle(r,legal));
  const rejected=[];
  const eligible=[];
  const minConfidence=options.minOracleConfidence??0.60;
  const requireDomainDescriptor=options.requireDomainDescriptor===true;

  for(const oracle of normalized){
    const reasons=[];
    const domainCheck=verifyOracleDomain(node,oracle.domain);
    const legacyAllowed=!requireDomainDescriptor&&oracle.claimedDomainVerified===true;
    if(!domainCheck.ok&&!legacyAllowed) reasons.push('domain_unverified',...domainCheck.reasons);
    if(oracle.confidence<minConfidence) reasons.push('confidence_too_low');
    if(!legal.includes(oracle.action)) reasons.push('oracle_action_illegal');
    const covered=legal.filter(a=>finite(oracle.evByAction[a]));
    if(covered.length<2) reasons.push('ev_coverage_insufficient');
    const normalizedOracle={...oracle,domainVerified:domainCheck.ok,legacyDomainClaimUsed:legacyAllowed&&!domainCheck.ok,domainCheck};
    if(reasons.length) rejected.push({oracleId:oracle.oracleId,reasons:[...new Set(reasons)],domainCheck});
    else eligible.push(normalizedOracle);
  }

  const highImpact=isHighImpactNode(node);
  const minOracles=highImpact?(options.minHighImpactOracles??2):(options.minOracles??1);
  if(eligible.length<minOracles){
    return blockedBase({highImpact,reason:'insufficient_verified_oracles',required:minOracles,eligible,rejected,legal});
  }

  if(highImpact&&options.requireIndependentFamilies===true){
    const families=[...new Set(eligible.map(o=>o.family).filter(Boolean))];
    const minFamilies=options.minHighImpactFamilies??2;
    if(families.length<minFamilies){
      return blockedBase({highImpact,reason:'insufficient_independent_oracles',required:minFamilies,eligible,rejected,legal,extra:{families}});
    }
  }

  const evByAction={};
  const coverageByAction={};
  const spreadByAction={};
  for(const action of legal){
    const values=eligible.filter(o=>finite(o.evByAction[action])).map(o=>o.evByAction[action]);
    const rows=eligible.filter(o=>finite(o.evByAction[action])).map(o=>({value:o.evByAction[action],weight:o.confidence}));
    evByAction[action]=weightedAverage(rows);
    coverageByAction[action]=rows.length;
    spreadByAction[action]=values.length>=2?Math.max(...values)-Math.min(...values):0;
  }
  const candidates=legal.filter(a=>finite(evByAction[a]));
  if(candidates.length<2){
    return blockedBase({highImpact,reason:'consensus_ev_coverage_insufficient',required:minOracles,eligible,rejected,legal,extra:{evByAction,coverageByAction,spreadByAction}});
  }

  const maxEvSpreadBB=finite(options.maxEvSpreadBB)?options.maxEvSpreadBB:Infinity;
  const divergentActions=candidates.filter(a=>spreadByAction[a]>maxEvSpreadBB);
  if(divergentActions.length){
    return blockedBase({
      highImpact,reason:'oracle_ev_disagreement',required:minOracles,eligible,rejected,legal,
      extra:{evByAction,coverageByAction,spreadByAction,divergentActions,maxEvSpreadBB},
    });
  }

  candidates.sort((a,b)=>evByAction[b]-evByAction[a]);
  const bestAction=candidates[0];
  const bestEV=evByAction[bestAction];
  const secondEV=evByAction[candidates[1]];
  const marginBB=bestEV-secondEV;
  const agreementWeight=eligible.reduce((sum,o)=>sum+(o.action===bestAction?o.confidence:0),0);
  const totalWeight=eligible.reduce((sum,o)=>sum+o.confidence,0);
  const actionAgreement=totalWeight>0?agreementWeight/totalWeight:0;
  const minActionAgreement=finite(options.minActionAgreement)?options.minActionAgreement:0;
  if(actionAgreement<minActionAgreement){
    return blockedBase({
      highImpact,reason:'oracle_action_disagreement',required:minOracles,eligible,rejected,legal,
      extra:{evByAction,coverageByAction,spreadByAction,bestAction,bestEV,secondEV,marginBB,actionAgreement,minActionAgreement},
    });
  }

  const confidence=clamp((actionAgreement*0.55)+Math.min(1,Math.max(0,marginBB)/0.50)*0.45,0,1);

  return {
    version:'cash-pro-lab-oracle-consensus-v1',
    blocked:false,
    highImpact,
    eligibleCount:eligible.length,
    eligible,
    rejected,
    evByAction,
    coverageByAction,
    spreadByAction,
    bestAction,
    bestEV,
    secondEV,
    marginBB,
    actionAgreement,
    confidence,
  };
}

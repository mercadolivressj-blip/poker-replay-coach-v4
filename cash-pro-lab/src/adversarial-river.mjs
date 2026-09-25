import {getArchetype} from './opponents.mjs';
import {createExplicitComboRange} from './combo-range.mjs';
import {applyRiverActionEvidence,riverLineSummary} from './river-line-model.mjs';
import {riverCallAudit,aggressionDisagreementGate} from './river-ev-audit.mjs';
import {drawCompletion,heroSuitBlockers} from './river-range-audit.mjs';
import {auditDecision,aggregateRegret} from './regret.mjs';

const DEPTHS=[20,30,40,50,75,100,150,200];
const SIZINGS=[25,33,50,75,100,125,150];
const ARCHETYPES=['BALANCED_REG','TIGHT_REG','AGGRO_REG','LAG_REG','TRICKY_REG'];

export const RIVER_TEMPLATES=Object.freeze([
  Object.freeze({
    id:'HEART_FLUSH_COMPLETES_K3',
    hero:['Ks','3s'], turn:['4s','2h','Kh','7d'], river:'3h',
    candidates:[
      ['QhTh','value'],['Ah5h','value'],['Jh9h','value'],['6c5c','value'],
      ['KcQc','medium'],['KdQd','medium'],['QcJc','bluff'],['QdJd','bluff'],['Tc9c','bluff'],['Td9d','bluff']
    ]
  }),
  Object.freeze({
    id:'SPADE_FLUSH_COMPLETES_TOP_PAIR',
    hero:['Kd','Qd'], turn:['As','7s','2c','9h'], river:'3s',
    candidates:[
      ['JsTs','value'],['Qs8s','value'],['Ks6s','value'],['5c4c','value'],
      ['AcJd','medium'],['AdTc','medium'],['JhTh','bluff'],['QcJc','bluff'],['Td8d','bluff'],['6d5d','bluff']
    ]
  }),
  Object.freeze({
    id:'STRAIGHT_COMPLETES_OVERPAIR',
    hero:['Ah','Ad'], turn:['Kc','Qd','7s','2c'], river:'Jh',
    candidates:[
      ['Tc9c','value'],['Ts9s','value'],['AcTc','value'],['KhQh','value'],
      ['K d'.replace(' ',''),'invalid-placeholder']
    ].filter(x=>x[1]!=='invalid-placeholder').concat([
      ['Ks8s','medium'],['Qc8c','medium'],['9d8d','bluff'],['8h6h','bluff'],['5d4d','bluff'],['6s5s','bluff']
    ])
  }),
  Object.freeze({
    id:'PAIRED_RIVER_TRAP',
    hero:['Ac','Kc'], turn:['Ah','7d','7s','2c'], river:'Kd',
    candidates:[
      ['7c7h','value'],['KhKs','value'],['AdQd','value'],['AsQs','value'],
      ['QhQd','medium'],['JcJh','medium'],['Tc9c','bluff'],['Ts9s','bluff'],['6h5h','bluff'],['5d4d','bluff']
    ]
  }),
  Object.freeze({
    id:'FOUR_FLUSH_NO_BLOCKER',
    hero:['Kc','Kd'], turn:['Ah','7h','2h','9c'], river:'3h',
    candidates:[
      ['QhQs','value'],['JhJc','value'],['ThTs','value'],['8h8c','value'],
      ['AsQd','medium'],['AcQd','medium'],['QsJc','bluff'],['Td9d','bluff'],['6s5s','bluff'],['5c4c','bluff']
    ]
  }),
  Object.freeze({
    id:'BLANK_RIVER_OVERPAIR',
    hero:['Qs','Qd'], turn:['Jc','8s','4h','2d'], river:'2c',
    candidates:[
      ['JhJd','value'],['8h8d','value'],['4c4d','value'],['AhAd','value'],
      ['KcJd','medium'],['JdTd','medium'],['AcKc','bluff'],['Tc9c','bluff'],['7c6c','bluff'],['6h5h','bluff']
    ]
  })
]);

function mulberry32(seed){
  let a=seed>>>0;
  return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
}
const pick=(arr,rng)=>arr[Math.floor(rng()*arr.length)%arr.length];

function comboWeight(kind,profile,rng){
  const jitter=.75+rng()*.25;
  if(kind==='value') return Math.min(1,(.78+profile.thinValueRiver*.45)*jitter);
  if(kind==='medium') return Math.min(1,(.24+profile.thinValueRiver*.70)*jitter);
  return Math.min(1,(.12+profile.riverBluff*1.55)*jitter);
}

export function generateRiverScenario({seed=1,template=null,archetype=null,depthBb=null,sizePct=null}={}){
  const rng=mulberry32(seed);
  const t=template || pick(RIVER_TEMPLATES,rng);
  const archetypeId=archetype || pick(ARCHETYPES,rng);
  const profile=getArchetype(archetypeId);
  const depth=depthBb || pick(DEPTHS,rng);
  const sizing=sizePct || pick(SIZINGS,rng);
  const board=[...t.turn,t.river];
  const completion=drawCompletion(t.turn,board);
  const blocker=heroSuitBlockers(t.hero,board);

  const prior=createExplicitComboRange({
    source:`adversarial:${t.id}:${archetypeId}`,
    status:'lab-only',depthBb:depth,position:'VILLAIN',node:'RIVER_STRESS',
    combos:t.candidates.map(([combo,kind])=>({combo,origin:kind,weight:comboWeight(kind,profile,rng)}))
  });
  const posterior=applyRiverActionEvidence(prior,{
    board,hero:t.hero,action:'BET',sizePct:sizing,
    flushCompleted:completion.flushCompleted,turnCheckedBack:rng()<.55
  });
  const potBefore=10+Math.floor(rng()*70);
  const toCall=Number((potBefore*sizing/100).toFixed(2));
  const potAfterBet=Number((potBefore+toCall).toFixed(2));
  const callAudit=riverCallAudit({hero:t.hero,board,villainRange:posterior,potAfterBet,toCall});
  const line=riverLineSummary(posterior,{board,hero:t.hero});
  const aggressionGate=aggressionDisagreementGate({
    selectedAction:'RAISE',callAudit,independentAction:callAudit.action,rangeStatus:posterior.status
  });
  return {
    seed,templateId:t.id,archetype:archetypeId,depthBb:depth,sizePct:sizing,
    hero:[...t.hero],board,potBefore,potAfterBet,toCall,
    completion,blocker,line,callAudit,aggressionGate,rangeStatus:posterior.status
  };
}

export function runRiverStressSuite({samples=1000,seed=20260925}={}){
  const rows=[],audits=[];
  let calls=0,folds=0,blockedAggression=0,invalid=0,minEdge=Infinity,maxEdge=-Infinity;
  for(let i=0;i<samples;i++){
    try{
      const row=generateRiverScenario({seed:seed+i*7919});
      rows.push(row);
      if(row.callAudit.action==='CALL')calls++;else folds++;
      if(!row.aggressionGate.allowed)blockedAggression++;
      minEdge=Math.min(minEdge,row.callAudit.edge);maxEdge=Math.max(maxEdge,row.callAudit.edge);
      // Deliberately choose the opposite action every 7th case to verify regret catches it.
      const selected=i%7===0?(row.callAudit.action==='CALL'?'FOLD':'CALL'):row.callAudit.action;
      const evs={FOLD:0,CALL:row.callAudit.callEv};
      audits.push(auditDecision({selectedAction:selected,actionEVs:evs}));
    }catch(error){invalid++;rows.push({seed:seed+i*7919,error:String(error?.message||error)});}
  }
  return {
    version:'adversarial-river-v0.4',samples,seed,calls,folds,blockedAggression,invalid,
    minEdge:Number.isFinite(minEdge)?minEdge:null,maxEdge:Number.isFinite(maxEdge)?maxEdge:null,
    regret:aggregateRegret(audits),rows
  };
}

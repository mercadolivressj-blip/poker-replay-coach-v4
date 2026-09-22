import { BASELINE_META, classifyPreflopNode, handCode, lookupBaseline, normalizePosition } from './ranges-100z.js';

const ORDER=['fold','call','raise','limp'];
const LABEL={FOLD:'DESISTIR',CALL:'PAGAR',RAISE:'AUMENTAR'};
const VALID_ACTIONS=new Set(['FOLD','CALL','RAISE']);

export function seedRoll(seed=''){
  let h=0x811c9dc5;
  for(let i=0;i<String(seed).length;i++){h^=String(seed).charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}
  return (h%10000)/100;
}

export function pickFromDistribution(distribution,roll){
  let acc=0,last=null;
  for(const action of ORDER){const freq=Number(distribution?.[action])||0;if(freq<=0)continue;last=action;acc+=freq;if(roll<acc)return action;}
  return last;
}

const depthDirect=(d)=>typeof d==='number'&&Number.isFinite(d)&&d>=90&&d<=110;
function cleanLegal(input){return [...new Set((input||[]).map(x=>String(x).trim().toUpperCase()).filter(x=>VALID_ACTIONS.has(x)))];}

function resolveNode(input){
  if(input.node==='rfi'||input.node==='vs_open')return {node:input.node,versus:input.versus??null};
  return classifyPreflopNode(input.actionHistory||[]);
}

export function preflopBaselineDecision(input={}){
  if((input.board||[]).length!==0)return null;
  if((input.format??'cash')!=='cash')return null;
  if((input.tableSize??'6max')!=='6max')return null;
  if((input.heroCards||[]).length!==2)return null;
  const legal=cleanLegal(input.legalActions);if(!legal.length)return null;
  const classified=resolveNode(input);if(classified.node!=='rfi'&&classified.node!=='vs_open')return null;
  if(!depthDirect(input.depthBB))return null;
  const hand=handCode(input.heroCards),position=normalizePosition(input.heroPosition),versus=normalizePosition(classified.versus);
  if(!hand||!position)return null;
  if(input.multiway===true)return null;
  const entry=lookupBaseline({hand,position,versus,node:classified.node});if(!entry)return null;
  const distribution=entry.distribution;
  const seed=input.decisionKey??'';const roll=seedRoll(seed);const chosen=pickFromDistribution(distribution,roll);if(!chosen)return null;
  let code=null;
  if(chosen==='fold')code='FOLD';else if(chosen==='call')code='CALL';else if(chosen==='raise')code='RAISE';else if(chosen==='limp')code=classified.node==='rfi'&&position==='SB'?'CALL':null;
  if(!code)return {kind:'inconsistent',baselineAction:chosen,chart:BASELINE_META.version,reason:'A baseline indica LIMP fora de SB RFI unopened; nenhuma conversão silenciosa é permitida.'};
  if(!legal.includes(code))return {kind:'inconsistent',baselineAction:chosen,chart:BASELINE_META.version,reason:`A baseline indica ${chosen.toUpperCase()}, mas ${code} não está entre os botões confirmados (${legal.join(', ')}).`};
  const freqs=ORDER.filter(a=>distribution[a]>0).map(a=>`${a.toUpperCase()} ${distribution[a]}%`).join(' / ');
  const isMixed=ORDER.filter(a=>distribution[a]>0).length>1;
  const nodeText=classified.node==='rfi'?`${position} RFI`:`${position} vs ${versus}`;
  return {
    kind:'decision',advice:LABEL[code],actionCode:code,baselineAction:chosen,
    engine:`PREFLOP V1 · BASELINE DIRETA · ${BASELINE_META.version}`,
    reason:`${nodeText}: ${hand}. ${isMixed?`Mix da baseline: ${freqs}. Escolha determinística estável para este estado; frequências são simplificadas pela fonte.`:'Ação única da baseline para esta mão.'}`,
    chart:BASELINE_META.version,distribution,mixed:isMixed,seed,roll,node:classified.node,versus
  };
}

export function directPreflopInputFromState(state={},context={}){
  const depth=Number(context.depthBB);
  return {
    heroCards:state.heroCards||[],board:state.board||[],heroPosition:state.heroPosition,
    legalActions:state.legalActions||[],actionHistory:state.actionHistory||[],
    node:context.preflopNode??context.node,versus:context.versus??null,multiway:context.preflopMultiway===true,
    depthBB:Number.isFinite(depth)?depth:null,format:context.format??'cash',tableSize:context.tableSize??'6max',
    decisionKey:context.decisionKey??context.handId?.toString()??''
  };
}

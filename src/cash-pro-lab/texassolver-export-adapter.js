const finite=v=>typeof v==='number'&&Number.isFinite(v);
const CARD=/^[2-9TJQKA][cdhs]$/;
const rankValue=r=>'23456789TJQKA'.indexOf(r)+2;
const suitValue=s=>({c:0,d:1,h:2,s:3})[s];
const cardInt=card=>(rankValue(card[0])-2)*4+suitValue(card[1]);

export function texasSolverComboKey(heroCards=[]){
  if(!Array.isArray(heroCards)||heroCards.length!==2||heroCards.some(c=>typeof c!=='string'||!CARD.test(c))) return null;
  return [...heroCards].sort((a,b)=>cardInt(b)-cardInt(a)).join('');
}

function exactActionMap(rawActions=[],actionMap={},node={}){
  const legalIds=new Set((node.legalOptions||[]).map(o=>String(o.id)));
  const rows=[];const errors=[];
  for(const raw of rawActions){
    const key=String(raw);
    const choiceId=actionMap?.[key];
    if(!choiceId){errors.push(`action_map_missing:${key}`);continue;}
    if(!legalIds.has(String(choiceId))){errors.push(`choice_not_legal:${choiceId}`);continue;}
    rows.push({raw:key,choiceId:String(choiceId)});
  }
  if(new Set(rows.map(r=>r.choiceId)).size!==rows.length) errors.push('action_map_choice_collision');
  return {rows,errors};
}

export function texasSolverNodeToOracle({node={},solveNode={},metadata={}}={}){
  const errors=[];
  if(!metadata.artifactId) errors.push('artifact_id_missing');
  if(!metadata.artifactVersion) errors.push('artifact_version_missing');
  if(!metadata.family) errors.push('family_missing');
  if(!metadata.domain) errors.push('domain_missing');
  if(!finite(metadata.evScaleToBB)||metadata.evScaleToBB<=0) errors.push('ev_scale_to_bb_missing');
  if(!finite(metadata.confidence)||metadata.confidence<0||metadata.confidence>1) errors.push('confidence_missing');
  if(!metadata.actionMap||typeof metadata.actionMap!=='object') errors.push('action_map_missing');

  const actions=Array.isArray(solveNode?.actions)?solveNode.actions.map(String):[];
  if(actions.length<2) errors.push('solver_actions_missing');
  const comboKey=texasSolverComboKey(node.heroCards);
  if(!comboKey) errors.push('hero_combo_invalid');
  const evs=comboKey&&solveNode?.evs&&Array.isArray(solveNode.evs[comboKey])?solveNode.evs[comboKey]:null;
  if(!evs) errors.push('solver_combo_evs_missing');
  else if(evs.length!==actions.length) errors.push('solver_evs_length_mismatch');

  const strategy=comboKey&&solveNode?.strategy&&Array.isArray(solveNode.strategy[comboKey])?solveNode.strategy[comboKey]:null;
  if(strategy&&strategy.length!==actions.length) errors.push('solver_strategy_length_mismatch');

  const mapped=exactActionMap(actions,metadata.actionMap,node);
  errors.push(...mapped.errors);
  if(mapped.rows.length!==actions.length) errors.push('action_map_incomplete');
  if(errors.length){
    return {version:'cash-pro-lab-texassolver-adapter-v1',ok:false,errors:[...new Set(errors)],comboKey,oracle:null};
  }

  const evByChoice={};
  const strategyByChoice={};
  for(let i=0;i<actions.length;i++){
    const value=Number(evs[i]);
    if(!finite(value)) errors.push(`solver_ev_invalid:${actions[i]}`);
    const choiceId=mapped.rows[i].choiceId;
    evByChoice[choiceId]=value*metadata.evScaleToBB;
    if(strategy){
      const p=Number(strategy[i]);
      if(!finite(p)||p<0||p>1) errors.push(`solver_strategy_invalid:${actions[i]}`);
      else strategyByChoice[choiceId]=p;
    }
  }
  if(errors.length){
    return {version:'cash-pro-lab-texassolver-adapter-v1',ok:false,errors:[...new Set(errors)],comboKey,oracle:null};
  }

  const legalCovered=Object.entries(evByChoice).filter(([,v])=>finite(v));
  if(legalCovered.length<2){
    return {version:'cash-pro-lab-texassolver-adapter-v1',ok:false,errors:['choice_ev_coverage_insufficient'],comboKey,oracle:null};
  }
  legalCovered.sort((a,b)=>b[1]-a[1]);
  const choiceId=legalCovered[0][0];
  const option=(node.legalOptions||[]).find(o=>String(o.id)===choiceId);
  if(!option){
    return {version:'cash-pro-lab-texassolver-adapter-v1',ok:false,errors:['best_choice_not_legal'],comboKey,oracle:null};
  }

  return {
    version:'cash-pro-lab-texassolver-adapter-v1',
    ok:true,
    errors:[],
    comboKey,
    oracle:{
      oracleId:String(metadata.oracleId||metadata.artifactId),
      source:String(metadata.source||'TexasSolver-export'),
      family:String(metadata.family),
      choiceId,
      action:option.action,
      confidence:metadata.confidence,
      domain:metadata.domain,
      evByChoice,
      strategyByChoice:strategy?strategyByChoice:null,
      artifactId:String(metadata.artifactId),
      artifactVersion:String(metadata.artifactVersion),
      notes:[`combo:${comboKey}`,'exact-action-map','explicit-ev-scale-to-bb'],
    },
  };
}

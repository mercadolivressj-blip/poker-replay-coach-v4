const clean=(v)=>String(v??'').trim();
const canon=(v)=>clean(v).toLowerCase();
const num=(v)=>Number.isFinite(v)?Number(v):null;

export function createActionInferenceState({street='preflop'}={}){
  return {version:'action-inference-v1',street,commitments:{},maxCommitted:0,lastAt:null};
}

export function resetActionInferenceStreet(stateInput,street){
  const s=stateInput||createActionInferenceState();
  return {...s,street:street||s.street,commitments:{},maxCommitted:0,lastAt:null};
}

export function seedCommitments(stateInput,commitments={}){
  const s={...(stateInput||createActionInferenceState()),commitments:{}};
  let max=0;
  for(const [actor,raw] of Object.entries(commitments||{})){
    const v=num(raw);if(!actor||v==null||v<0)continue;
    s.commitments[actor]=v;if(v>max)max=v;
  }
  s.maxCommitted=max;
  return s;
}

function classify({previous,total,maxBefore,allIn=false,epsilon=.005}){
  if(allIn)return 'ALLIN';
  const raised=total>maxBefore+epsilon;
  const facedBet=previous<maxBefore-epsilon;
  if(raised){
    if(maxBefore<=epsilon&&previous<=epsilon)return 'BET';
    return 'RAISE';
  }
  if(facedBet&&Math.abs(total-maxBefore)<=epsilon)return 'CALL';
  return null;
}

export function inferCommitmentAction(stateInput,{
  actor,
  totalCommitted,
  at=Date.now(),
  confidence=1,
  allIn=false,
  source='local-commitment',
  epsilon=.005,
}={}){
  const state={...(stateInput||createActionInferenceState()),commitments:{...((stateInput||{}).commitments||{})}};
  const name=clean(actor),total=num(totalCommitted);
  if(!name||total==null||total<0)return {state,event:null,reason:'missing-actor-or-commitment'};
  const previous=num(state.commitments[name])??0;
  const maxBefore=num(state.maxCommitted)??0;
  if(total<previous-epsilon){
    return {state,event:null,reason:'commitment-decreased-without-street-reset'};
  }
  state.commitments[name]=Math.max(previous,total);
  state.maxCommitted=Math.max(maxBefore,total);
  state.lastAt=at;
  const delta=total-previous;
  if(delta<=epsilon)return {state,event:null,reason:'no-positive-delta'};
  const action=classify({previous,total,maxBefore,allIn,epsilon});
  if(!action)return {state,event:null,reason:'delta-not-enough-to-classify'};
  const conf=Math.max(0,Math.min(1,Number(confidence)||0));
  return {state,event:{
    version:'action-inference-v1',type:'action-candidate',status:'provisional',sovereign:false,
    source,actor:name,street:state.street,action,amount:Number(delta.toFixed(4)),
    totalCommitted:Number(total.toFixed(4)),previousCommitted:Number(previous.toFixed(4)),
    maxCommittedBefore:Number(maxBefore.toFixed(4)),capturedAt:at,confidence:Number(conf.toFixed(3)),
  }};
}

export function inferStackDeltaAction(stateInput,{
  actor,stackBefore,stackAfter,at=Date.now(),confidence=.65,allIn=false,source='local-stack-delta',epsilon=.005,
}={}){
  const before=num(stackBefore),after=num(stackAfter);
  if(before==null||after==null||after>before+epsilon)return {state:stateInput||createActionInferenceState(),event:null,reason:'invalid-stack-delta'};
  const delta=before-after;
  if(delta<=epsilon)return {state:stateInput||createActionInferenceState(),event:null,reason:'no-stack-spend'};
  const s=stateInput||createActionInferenceState();
  const previous=num(s.commitments?.[clean(actor)])??0;
  return inferCommitmentAction(s,{actor,totalCommitted:previous+delta,at,confidence,allIn,source,epsilon});
}

export function dedupeActionCandidates(previous=[],incoming=[]){
  const out=[],seen=new Set();
  for(const e of [...(Array.isArray(previous)?previous:[]),...(Array.isArray(incoming)?incoming:[])]){
    if(!e||typeof e!=='object')continue;
    const key=e.packetId?`packet:${e.packetId}`:[e.street,canon(e.actor),e.action,Number(e.totalCommitted??e.amount??0).toFixed(4)].join('|');
    if(seen.has(key))continue;seen.add(key);out.push(e);
  }
  return out.slice(-120);
}

export function actionInferenceSummary(events=[]){
  return (Array.isArray(events)?events:[]).map(e=>`${e.actor||'?'}:${e.action||'?'}:${e.amount??''}@${Math.round((e.confidence||0)*100)}%`);
}

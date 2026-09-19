from pathlib import Path

RUNTIME = Path('standalone-lab/study-runtime-public-v1.html')
TEST = Path('tests/study-public-runtime-v1.test.mjs')
PIN = 'f6ad1a9ed61e7a03538acba3059e6bb79d6da387'

s = RUNTIME.read_text()
if 'PUBLIC_ACTION_CAPTURE_V18' in s:
    print('Action Capture V1.8 already integrated')
    raise SystemExit(0)


def must_replace(old, new, count=1, label='anchor'):
    global s
    if old not in s:
        raise SystemExit(f'{label} missing')
    s = s.replace(old, new, count)

must_replace(
    '.stage video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}',
    '.stage video,.stage canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.stage canvas{pointer-events:none}',
    label='stage css',
)
must_replace(
    '<div class="stage"><video id="video" muted playsinline></video></div>',
    '<div class="stage"><video id="video" muted playsinline></video><canvas id="actionOverlay"></canvas></div>',
    label='stage html',
)
must_replace(
    '<script>',
    '<canvas id="actionAnalysis" style="display:none"></canvas><script type="module">',
    label='script tag',
)

imports = f"""// PUBLIC_ACTION_CAPTURE_V18
import {{ detectFeltPixels }} from 'https://cdn.jsdelivr.net/gh/mercadolivressj-blip/poker-replay-coach-v4@{PIN}/src/core/geometry.js';
import {{ ActionTextOcr }} from 'https://cdn.jsdelivr.net/gh/mercadolivressj-blip/poker-replay-coach-v4@{PIN}/src/core/action-ocr.js';
import {{ seatRegionsFromFelt, sampleSeats, createActionCaptureState, observeSeatSamples }} from 'https://cdn.jsdelivr.net/gh/mercadolivressj-blip/poker-replay-coach-v4@{PIN}/src/core/action-capture.js';
import {{ actionBandRegionsFromFelt, sampleActionBands, createActionBandState, observeActionBands }} from 'https://cdn.jsdelivr.net/gh/mercadolivressj-blip/poker-replay-coach-v4@{PIN}/src/core/action-band.js';
import {{ createActionSeatState, observeSeatCardState, applyActionSeatEvents, actionSeatEligibility }} from 'https://cdn.jsdelivr.net/gh/mercadolivressj-blip/poker-replay-coach-v4@{PIN}/src/core/action-seat-state.js';
import {{ shouldAcceptOcrAction }} from 'https://cdn.jsdelivr.net/gh/mercadolivressj-blip/poker-replay-coach-v4@{PIN}/src/core/action-ocr-gate.js';
"""
must_replace('<script type="module">\nconst VISION=', '<script type="module">\n' + imports + 'const VISION=', label='module imports')

must_replace(
    "const $=id=>document.getElementById(id),video=$('video');",
    "const $=id=>document.getElementById(id),video=$('video'),actionOverlay=$('actionOverlay'),actionAnalysis=$('actionAnalysis');\nconst actionOctx=actionOverlay.getContext('2d'),actionActx=actionAnalysis.getContext('2d',{willReadFrequently:true}),actionOcr=new ActionTextOcr();",
    label='dom refs',
)

old_vars = "let stream=null,running=false,generation=0,brainBusy=false,lastBrainKey='',handSeq=0,lastHeroKey='',heroAbsentStreak=0,heroAbsentSince=0,lastHeroConfirmedAt=0,metaUrgent=true,lastMetaRequestAt=0,handEpoch=1,handStartedAt=0,lockedPosition=null,lockedBlinds=null,blindCandidate='',blindVotes=0,potDropCandidate=null,potDropVotes=0,transitionSuspected=false,historyCandidateKey='',historyCandidateVotes=0,decisionPointKey='',decisionCandidateSig='',decisionCandidateVotes=0,pinnedDecisionPoint='';"
new_vars = old_vars[:-1] + ",positionCandidate='',positionVotes=0,brainSession=null,localFelt=null,localLastFeltAt=0,localCaptureState=null,localBandState=null,localSeatState=null,localActionLastTick=0,localOcrQueue=[],localOcrBusy=false,localConfirmedActions=[],remoteActionHistory=[],pendingCaptureEvents=[],localActionSeq=0;"
must_replace(old_vars, new_vars, label='runtime vars')

must_replace(
    "function setPosition(v,at){\n  if(!v)return;\n  if(!lockedPosition){lockedPosition=String(v);state.heroPosition=lockedPosition;fieldSeen.position=at||Date.now();}\n}",
    """function setPosition(v,at){
  if(!v||lockedPosition)return;
  const p=String(v).trim().toUpperCase();
  if(positionCandidate===p)positionVotes++;else{positionCandidate=p;positionVotes=1;}
  if(positionVotes>=2){lockedPosition=p;state.heroPosition=p;fieldSeen.position=at||Date.now();log('posição confirmada '+p);refreshLocalHistory();}
}""",
    label='position confirmation',
)

marker = "function historyText(a){return typeof a==='string'?a:JSON.stringify(a)}\n"
helpers = marker + """const VISUAL_ORDER=['hero','left-low','left-high','top','right-high','right-low'];
const POSITIONS_BY_N={6:['BTN','SB','BB','UTG','HJ','CO'],5:['BTN','SB','BB','UTG','CO'],4:['BTN','SB','BB','CO'],3:['BTN','SB','BB'],2:['SB','BB']};
function activeVisualSlots(){
  const known=VISUAL_ORDER.filter(id=>id==='hero'||localSeatState?.seats?.[id]?.seenCards===true);
  return known.length>=2?known:[];
}
function captureSeatMap(){
  const heroPos=state.heroPosition||lockedPosition,slots=activeVisualSlots();if(!heroPos||slots.length<2)return{};
  const positions=POSITIONS_BY_N[slots.length];if(!positions)return{};const heroIndex=positions.indexOf(heroPos);if(heroIndex<0)return{};
  const map={};slots.forEach((slot,i)=>map[slot]=positions[(heroIndex+i)%positions.length]);return map;
}
function resetLocalCapture(){
  localFelt=null;localLastFeltAt=0;localCaptureState=null;localBandState=null;localSeatState=null;localOcrQueue=[];localOcrBusy=false;localConfirmedActions=[];remoteActionHistory=[];pendingCaptureEvents=[];localActionSeq=0;brainSession=null;positionCandidate='';positionVotes=0;
  if(actionOverlay)actionOctx.clearRect(0,0,actionOverlay.width,actionOverlay.height);
}
function refreshLocalHistory(){
  const map=captureSeatMap();
  const rows=localConfirmedActions.filter(a=>a.street==='preflop'&&map[a.seatId]).slice().sort((a,b)=>a.at-b.at).map(a=>`${map[a.seatId]} ${a.action}${a.amount!=null?' '+a.amount:''}`);
  state.actionHistory=rows.length?rows:[...remoteActionHistory];
  if(rows.length){fieldSeen.history=Date.now();log('LEDGER LOCAL '+rows.join(' | '));}
}
function confirmLocalAction({seatId,action,amount=null,at=Date.now(),confidence=.8,source='local-action-text'}){
  if(!seatId||!action||seatId==='hero'||seatId==='table')return;
  const street=state.board.length>=5?'river':state.board.length===4?'turn':state.board.length>=3?'flop':'preflop';
  const recent=localConfirmedActions.slice(-8).find(a=>a.seatId===seatId&&a.action===action&&String(a.amount??'')===String(amount??'')&&at-a.at<1800);if(recent)return;
  const row={id:++localActionSeq,seatId,action,amount,at,confidence,source,street};localConfirmedActions.push(row);localConfirmedActions=localConfirmedActions.slice(-80);
  pendingCaptureEvents.push({type:action==='FOLD'?'fold-candidate':'action-candidate',seatId,action,amount,at,confidence,source,capturedAt:at,status:'confirmed-local',sovereign:true});
  refreshLocalHistory();lastBrainKey='';brainSoon();
}
function localRect(r){return{x:r.x*actionOverlay.width,y:r.y*actionOverlay.height,w:r.w*actionOverlay.width,h:r.h*actionOverlay.height}}
function localCrop(rect,pad=.04){
  const x=Math.max(0,rect.x-rect.w*pad),y=Math.max(0,rect.y-rect.h*pad),w=Math.min(1-x,rect.w*(1+pad*2)),h=Math.min(1-y,rect.h*(1+pad*2));
  const sx=Math.max(0,Math.round(x*video.videoWidth)),sy=Math.max(0,Math.round(y*video.videoHeight)),sw=Math.max(4,Math.min(video.videoWidth-sx,Math.round(w*video.videoWidth))),sh=Math.max(4,Math.min(video.videoHeight-sy,Math.round(h*video.videoHeight))),c=document.createElement('canvas');
  c.width=sw;c.height=sh;c.getContext('2d').drawImage(video,sx,sy,sw,sh,0,0,sw,sh);return c;
}
function drawLocalCapture(){
  if(!actionOverlay)return;actionOctx.clearRect(0,0,actionOverlay.width,actionOverlay.height);if(!localFelt)return;
  let r=localRect(localFelt);actionOctx.strokeStyle='#45ef8f';actionOctx.lineWidth=2;actionOctx.strokeRect(r.x,r.y,r.w,r.h);
  for(const seat of seatRegionsFromFelt(localFelt)){const a=localRect(seat.region),c=localRect(seat.cardRegion);actionOctx.strokeStyle='#50c8ff';actionOctx.strokeRect(a.x,a.y,a.w,a.h);actionOctx.strokeStyle='#ffe46b';actionOctx.strokeRect(c.x,c.y,c.w,c.h);}
  for(const b of actionBandRegionsFromFelt(localFelt)){r=localRect(b.region);actionOctx.strokeStyle='#ff9d3d';actionOctx.lineWidth=2;actionOctx.strokeRect(r.x,r.y,r.w,r.h);}
}
function enqueueLocalOcr(e){
  if(!localFelt||!e?.seatId||e.seatId==='hero'||e.seatId==='table')return;
  const elig=actionSeatEligibility(localSeatState,e.seatId);if(!elig.eligible)return;
  const band=actionBandRegionsFromFelt(localFelt).find(x=>x.id===e.seatId);if(!band)return;
  localOcrQueue.push({e,crops:[localCrop(band.region,.03),localCrop(band.region,.10)]});if(localOcrQueue.length>8)localOcrQueue=localOcrQueue.slice(-8);void drainLocalOcr();
}
async function drainLocalOcr(){
  if(localOcrBusy)return;localOcrBusy=true;
  try{while(localOcrQueue.length){
    const job=localOcrQueue.shift(),hits=[];
    for(const crop of job.crops){const r=await actionOcr.read(crop,{timeoutMs:1200});if(r?.parsed)hits.push(r);}
    if(!hits.length)continue;
    const good=[];for(const hit of hits){const p=hit.parsed,conf=Math.max(0,Math.min(1,(Number(hit.confidence)||0)/100)),elig=actionSeatEligibility(localSeatState,job.e.seatId),gate=shouldAcceptOcrAction({action:p.action,confidence:conf,activeThisHand:elig.eligible,folded:elig.reason==='seat-already-folded',raw:hit.text});if(gate.ok)good.push({p,conf});}
    if(!good.length)continue;const first=good[0],same=good.filter(x=>x.p.action===first.p.action&&String(x.p.amount??'')===String(first.p.amount??''));
    if(same.length>=2||first.conf>=.82)confirmLocalAction({seatId:job.e.seatId,action:first.p.action,amount:first.p.amount,at:job.e.at,confidence:Math.max(...same.map(x=>x.conf),first.conf)});
  }}finally{localOcrBusy=false;}
}
function actionTick(ts){
  if(!running)return;requestAnimationFrame(actionTick);if(ts-localActionLastTick<78)return;localActionLastTick=ts;if(!video.videoWidth)return;
  const aw=480,ah=Math.max(270,Math.round(aw*video.videoHeight/video.videoWidth));if(actionAnalysis.width!==aw||actionAnalysis.height!==ah){actionAnalysis.width=aw;actionAnalysis.height=ah;actionOverlay.width=video.videoWidth;actionOverlay.height=video.videoHeight;}
  actionActx.drawImage(video,0,0,aw,ah);const img=actionActx.getImageData(0,0,aw,ah),now=Date.now();
  if(!localFelt||now-localLastFeltAt>1100){localFelt=detectFeltPixels(img.data,aw,ah)||localFelt;localLastFeltAt=now;if(localFelt){if(!localCaptureState)localCaptureState=createActionCaptureState(seatRegionsFromFelt(localFelt));if(!localBandState)localBandState=createActionBandState(actionBandRegionsFromFelt(localFelt));if(!localSeatState)localSeatState=createActionSeatState(seatRegionsFromFelt(localFelt));}}
  if(!localFelt)return;
  const samples=sampleSeats(img.data,aw,ah,localFelt),f=observeSeatSamples(localCaptureState,samples,now,{motionThreshold:.09,foldDrop:.12,refractoryMs:420,confirmFrames:2});localCaptureState=f.state;localSeatState=observeSeatCardState(localSeatState,localCaptureState,now);localSeatState=applyActionSeatEvents(localSeatState,f.events,now);
  let transitioned=false;
  for(const e of f.events){
    if(e.type==='fold-candidate')confirmLocalAction({seatId:e.seatId,action:'FOLD',at:e.at,confidence:e.confidence,source:'fold-v1.2'});
    if(e.type==='table-transition'){beginBoundary('Action Capture detectou transição de mão.',{clearHero:true,startedAt:e.at});transitioned=true;break;}
  }
  if(transitioned)return;
  const b=observeActionBands(localBandState,sampleActionBands(img.data,aw,ah,localFelt),now,{threshold:.026,refractoryMs:180,confirmFrames:1});localBandState=b.state;for(const e of b.events)enqueueLocalOcr(e);drawLocalCapture();
}
"""
if marker not in s:
    raise SystemExit('history helper anchor missing')
s = s.replace(marker, helpers, 1)

must_replace(
    "function historyMerge(next,at){\n  if(!Array.isArray(next)||!next.length)return;",
    "function historyMerge(next,at){\n  if(!Array.isArray(next)||!next.length)return;\n  remoteActionHistory=next;",
    label='history merge start',
)
must_replace(
    "state.actionHistory=next;fieldSeen.history=at||Date.now();historyCandidateKey='';historyCandidateVotes=0;",
    "remoteActionHistory=next;fieldSeen.history=at||Date.now();historyCandidateKey='';historyCandidateVotes=0;refreshLocalHistory();",
    label='history merge commit',
)

must_replace(
    "handEpoch++;handStartedAt=startedAt;lockedPosition=null;lockedBlinds=null;blindCandidate='';blindVotes=0;potDropCandidate=null;potDropVotes=0;transitionSuspected=false;",
    "handEpoch++;handStartedAt=startedAt;lockedPosition=null;positionCandidate='';positionVotes=0;lockedBlinds=null;blindCandidate='';blindVotes=0;potDropCandidate=null;potDropVotes=0;transitionSuspected=false;resetLocalCapture();",
    label='boundary reset',
)
must_replace(
    "if(!skipEpoch){handEpoch++;handStartedAt=startedAt;lockedPosition=null;lockedBlinds=null;blindCandidate='';blindVotes=0;potDropCandidate=null;potDropVotes=0;transitionSuspected=false;}",
    "if(!skipEpoch){handEpoch++;handStartedAt=startedAt;lockedPosition=null;positionCandidate='';positionVotes=0;lockedBlinds=null;blindCandidate='';blindVotes=0;potDropCandidate=null;potDropVotes=0;transitionSuspected=false;resetLocalCapture();}",
    label='hand reset',
)

must_replace(
    "lockedPosition='BB';state.heroPosition='BB';fieldSeen.position=r.at;metaUrgent=false;",
    "lockedPosition='BB';positionCandidate='BB';positionVotes=2;state.heroPosition='BB';fieldSeen.position=r.at;metaUrgent=false;refreshLocalHistory();",
    label='bb option sovereign position',
)

old_fetch = "const r=await fetch(BRAIN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vision:effectiveState,context:{format:$('format').value,tableSize:'6max',handId:handSeq||null,preflopNode:node,versus}})}),j=await r.json();"
new_fetch = "const captureBatch=[...pendingCaptureEvents],seatMap=captureSeatMap();const r=await fetch(BRAIN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vision:effectiveState,context:{format:$('format').value,tableSize:'6max',handId:handSeq||null,preflopNode:node,versus,useStudySession:true,session:brainSession,captureEvents:captureBatch,captureSeatMap:seatMap}})}),j=await r.json();"
must_replace(old_fetch, new_fetch, label='brain request')
must_replace(
    "if(!r.ok)throw Error(j.error||('HTTP '+r.status));const d=j.result||{};",
    "if(!r.ok)throw Error(j.error||('HTTP '+r.status));if(j.session)brainSession=j.session;if(captureBatch.length)pendingCaptureEvents.splice(0,captureBatch.length);const d=j.result||{};",
    label='brain session response',
)

must_replace(
    "stream.getVideoTracks()[0].addEventListener('ended',stop);\n    loop('hero',320",
    "stream.getVideoTracks()[0].addEventListener('ended',stop);void actionOcr.prewarm();localActionLastTick=0;requestAnimationFrame(actionTick);\n    loop('hero',320",
    label='capture start',
)
must_replace(
    "function stop(){running=false;generation++;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;log('captura parada')}",
    "function stop(){running=false;generation++;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;resetLocalCapture();log('captura parada')}",
    label='capture stop',
)

RUNTIME.write_text(s)

t = TEST.read_text()
if 'PUBLIC_ACTION_CAPTURE_V18' not in t:
    assertions = """
assert.match(html,/PUBLIC_ACTION_CAPTURE_V18/);
assert.match(html,/ActionTextOcr/);
assert.match(html,/observeSeatSamples/);
assert.match(html,/observeActionBands/);
assert.match(html,/function actionTick\(/);
assert.match(html,/function captureSeatMap\(/);
assert.match(html,/function confirmLocalAction\(/);
assert.match(html,/LEDGER LOCAL/);
assert.match(html,/captureEvents:captureBatch/);
assert.match(html,/captureSeatMap:seatMap/);
assert.match(html,/useStudySession:true/);
assert.match(html,/brainSession/);
assert.match(html,/if\(transitioned\)return/);
"""
    t = t.replace("console.log(", assertions + "\nconsole.log(", 1)
    TEST.write_text(t)

print('Action Capture V1.8 integrated into public runtime')

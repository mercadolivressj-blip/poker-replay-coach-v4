from pathlib import Path

p=Path('standalone-lab/study-runtime-public-v1.html')
s=p.read_text()
if 'CAPTURE_STABILITY_V2' in s:
    print('already patched')
else:
    s=s.replace("localActionSeq=0;", "localActionSeq=0,localSweepAt=0,localSweepIndex=0;", 1)

    old="""function refreshLocalHistory(){
  const map=captureSeatMap();
  const rows=localConfirmedActions.filter(a=>a.street==='preflop'&&map[a.seatId]).slice().sort((a,b)=>a.at-b.at).map(a=>`${map[a.seatId]} ${a.action}${a.amount!=null?' '+a.amount:''}`);
  state.actionHistory=rows.length?rows:[...remoteActionHistory];
  if(rows.length){fieldSeen.history=Date.now();log('LEDGER LOCAL '+rows.join(' | '));}
}"""
    new="""// CAPTURE_STABILITY_V2
function strategicActionCount(list){return (list||[]).map(historyText).filter(x=>/CALL|PAGA|LIMP|RAISE|AUMENT|3-?BET|ALL-?IN|ALLIN|BET/i.test(x)&&!/POST\\s+(SB|BB)/i.test(x)).length;}
function refreshLocalHistory(){
  const map=captureSeatMap();
  const rows=localConfirmedActions.filter(a=>a.street==='preflop'&&map[a.seatId]).slice().sort((a,b)=>a.at-b.at).map(a=>`${map[a.seatId]} ${a.action}${a.amount!=null?' '+a.amount:''}`);
  const remote=[...remoteActionHistory],localStrategic=strategicActionCount(rows),remoteStrategic=strategicActionCount(remote);
  state.actionHistory=localStrategic>0?rows:(remoteStrategic>0?remote:(rows.length?rows:remote));
  if(rows.length)log('LEDGER LOCAL '+rows.join(' | '));
  if(state.actionHistory.length)fieldSeen.history=Date.now();
}"""
    if old not in s: raise SystemExit('refreshLocalHistory anchor missing')
    s=s.replace(old,new,1)

    old="const elig=actionSeatEligibility(localSeatState,e.seatId);if(!elig.eligible)return;"
    new="const elig=actionSeatEligibility(localSeatState,e.seatId);if(elig.reason==='seat-already-folded')return;"
    if old not in s: raise SystemExit('eligibility anchor missing')
    s=s.replace(old,new,1)
    s=s.replace("activeThisHand:elig.eligible,folded:elig.reason==='seat-already-folded'", "activeThisHand:elig.eligible||state.board.length===0,folded:elig.reason==='seat-already-folded'", 1)

    marker="async function drainLocalOcr(){"
    sweep="""function sweepLocalOcr(now){
  if(state.board.length||!localFelt||localOcrBusy||localOcrQueue.length>2||now-localSweepAt<320)return;
  const bands=actionBandRegionsFromFelt(localFelt);if(!bands.length)return;localSweepAt=now;
  for(let tries=0;tries<bands.length;tries++){
    const b=bands[localSweepIndex++%bands.length],elig=actionSeatEligibility(localSeatState,b.id);
    if(elig.reason==='seat-already-folded')continue;
    enqueueLocalOcr({type:'action-band-sweep',seatId:b.id,at:now,sweep:true});break;
  }
}
"""
    if marker not in s: raise SystemExit('drain marker missing')
    s=s.replace(marker,sweep+marker,1)

    old="""  let transitioned=false;
  for(const e of f.events){
    if(e.type==='fold-candidate')confirmLocalAction({seatId:e.seatId,action:'FOLD',at:e.at,confidence:e.confidence,source:'fold-v1.2'});
    if(e.type==='table-transition'){beginBoundary('Action Capture detectou transição de mão.',{clearHero:true,startedAt:e.at});transitioned=true;break;}
  }
  if(transitioned)return;
  const b=observeActionBands(localBandState,sampleActionBands(img.data,aw,ah,localFelt),now,{threshold:.026,refractoryMs:180,confirmFrames:1});localBandState=b.state;for(const e of b.events)enqueueLocalOcr(e);drawLocalCapture();"""
    new="""  for(const e of f.events){
    if(e.type==='fold-candidate')confirmLocalAction({seatId:e.seatId,action:'FOLD',at:e.at,confidence:e.confidence,source:'fold-v1.2'});
    if(e.type==='table-transition')log('Action Capture: transição local observada; aguardando confirmação por Hero/pot.');
  }
  const b=observeActionBands(localBandState,sampleActionBands(img.data,aw,ah,localFelt),now,{threshold:.026,refractoryMs:180,confirmFrames:1});localBandState=b.state;for(const e of b.events)enqueueLocalOcr(e);sweepLocalOcr(now);drawLocalCapture();"""
    if old not in s: raise SystemExit('transition block missing')
    s=s.replace(old,new,1)
    s=s.replace("localActionSeq=0;brainSession=null;", "localActionSeq=0;localSweepAt=0;localSweepIndex=0;brainSession=null;", 1)
    p.write_text(s)


t=Path('tests/study-public-runtime-v1.test.mjs')
x=t.read_text()
if 'CAPTURE_STABILITY_V2' not in x:
    x=x.replace("assert.match(html,/if\\(transitioned\\)return/);", "assert.match(html,/CAPTURE_STABILITY_V2/);\nassert.match(html,/function strategicActionCount\\(/);\nassert.match(html,/function sweepLocalOcr\\(/);\nassert.match(html,/transição local observada; aguardando confirmação por Hero\\/pot/);\nassert.doesNotMatch(html,/beginBoundary\\('Action Capture detectou transição de mão/);")
    t.write_text(x)

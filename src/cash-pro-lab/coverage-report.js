const keyOf=(axes={},fields=[])=>fields.map(f=>`${f}=${axes?.[f]??'?'}`).join('|');

function bump(map,key,row){
  const current=map.get(key)||{key,tickets:0,studied:0,blocked:0,totalEvLossBB:0,highImpact:0};
  current.tickets++;
  if(row?.status==='STUDIED'){
    current.studied++;
    current.totalEvLossBB+=Number(row?.audit?.evLossBB)||0;
    if(row?.audit?.highImpact) current.highImpact++;
  }else current.blocked++;
  map.set(key,current);
}

function sorted(map){
  return [...map.values()].map(r=>({...r,studyRate:r.tickets?r.studied/r.tickets:0})).sort((a,b)=>{
    if(a.studyRate!==b.studyRate) return a.studyRate-b.studyRate;
    if(a.totalEvLossBB!==b.totalEvLossBB) return b.totalEvLossBB-a.totalEvLossBB;
    return a.key.localeCompare(b.key);
  });
}

export function buildCoverageReport(evaluations=[],options={}){
  const rows=Array.isArray(evaluations)?evaluations:[];
  const primaryFields=options.primaryFields||['street','heroPosition','effectiveStackBB','activePlayers'];
  const tacticalFields=options.tacticalFields||['street','potClass','facingClass','textureClass','initiative'];
  const primary=new Map(),tactical=new Map(),bySplit=new Map();
  const fingerprints={train:new Set(),dev:new Set(),holdout:new Set()};

  for(const row of rows){
    const ticket=row?.ticket||{};
    const axes=ticket.axes||{};
    bump(primary,keyOf(axes,primaryFields),row);
    bump(tactical,keyOf(axes,tacticalFields),row);
    bump(bySplit,String(ticket.split||'unknown'),row);
    const fp=row?.node?.fingerprint;
    if(fp&&fingerprints[ticket.split]) fingerprints[ticket.split].add(fp);
  }

  const trainHoldoutOverlap=[...fingerprints.holdout].filter(fp=>fingerprints.train.has(fp));
  const devHoldoutOverlap=[...fingerprints.holdout].filter(fp=>fingerprints.dev.has(fp));
  const splits=sorted(bySplit);
  const studied=rows.filter(r=>r?.status==='STUDIED').length;

  return {
    version:'cash-pro-lab-coverage-report-v1',
    evaluations:rows.length,
    studied,
    blocked:rows.length-studied,
    primary:sorted(primary),
    tactical:sorted(tactical),
    splits,
    leakage:{
      trainHoldoutFingerprintOverlap:trainHoldoutOverlap.length,
      devHoldoutFingerprintOverlap:devHoldoutOverlap.length,
      clean:trainHoldoutOverlap.length===0&&devHoldoutOverlap.length===0,
    },
    warnings:[
      ...(trainHoldoutOverlap.length?['train_holdout_fingerprint_leakage']:[]),
      ...(devHoldoutOverlap.length?['dev_holdout_fingerprint_leakage']:[]),
      ...(rows.length&&studied/rows.length<0.5?['study_rate_below_50pct']:[]),
    ],
  };
}

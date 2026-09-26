const severityWeight={negligible:0,small:1,material:4,major:12,catastrophic:40};
const blockWeight={UNDERSTANDING_PROOF:30,STUDENT_RUNTIME:20,STUDENT_LEGALITY:50,TEACHER_CONSENSUS:8,EV_AUDIT:20,ORACLE_PROVIDER:4,NODE_FACTORY:6};

function cellKey(ticket={}){
  const a=ticket.axes||{};
  return [
    `street=${a.street??'?'}`,`pos=${a.heroPosition??'?'}`,`stack=${a.effectiveStackBB??'?'}`,
    `players=${a.activePlayers??'?'}`,`pot=${a.potClass??'?'}`,`facing=${a.facingClass??'?'}`,
    `texture=${a.textureClass??'?'}`,`initiative=${a.initiative??'?'}`,
  ].join('|');
}

function scoreRow(row={}){
  if(row?.ticket?.split!=='train') return -Infinity;
  if(row.status==='STUDIED'){
    const loss=Number(row?.audit?.evLossBB)||0;
    const sev=severityWeight[row?.audit?.severity]||0;
    const impact=row?.audit?.highImpact?25:0;
    const uncertainty=(1-(Number(row?.audit?.consensusConfidence)||0))*5;
    return loss*100+sev+impact+uncertainty;
  }
  return (blockWeight[row?.phase]||5)+(row?.proof?.highImpact?20:0);
}

export function buildActiveLearningQueue(evaluations=[],options={}){
  const maxItems=options.maxItems??10000;
  const train=(Array.isArray(evaluations)?evaluations:[]).filter(r=>r?.ticket?.split==='train');
  const ranked=train.map(row=>({row,score:scoreRow(row),cellKey:cellKey(row.ticket)}))
    .filter(x=>Number.isFinite(x.score)&&x.score>0)
    .sort((a,b)=>b.score-a.score);

  const groups=new Map();
  for(const item of ranked){
    const g=groups.get(item.cellKey)||{cellKey:item.cellKey,examples:0,totalPriority:0,totalEvLossBB:0,blocked:0,highImpact:0};
    g.examples++;g.totalPriority+=item.score;
    if(item.row.status==='STUDIED') g.totalEvLossBB+=Number(item.row?.audit?.evLossBB)||0; else g.blocked++;
    if(item.row?.audit?.highImpact||item.row?.proof?.highImpact) g.highImpact++;
    groups.set(item.cellKey,g);
  }

  const focusCells=[...groups.values()].sort((a,b)=>b.totalPriority-a.totalPriority);
  const queue=ranked.slice(0,maxItems).map(({row,score,cellKey})=>({
    fingerprint:row?.node?.fingerprint??null,
    decisionId:row?.node?.decisionId??null,
    cellKey,
    priority:score,
    reason:row.status==='STUDIED'?'ev_loss_or_uncertainty':`blocked:${row.phase}`,
    evLossBB:row?.audit?.evLossBB??null,
    highImpact:Boolean(row?.audit?.highImpact||row?.proof?.highImpact),
    sourceSplit:'train',
  }));

  return {
    version:'cash-pro-lab-active-learning-v1',
    inputEvaluations:Array.isArray(evaluations)?evaluations.length:0,
    trainEvaluations:train.length,
    queued:queue.length,
    queue,
    focusCells,
    holdoutConsumed:false,
    note:'Only train-split evidence may generate learning priorities. Dev and holdout never teach the challenger.',
  };
}

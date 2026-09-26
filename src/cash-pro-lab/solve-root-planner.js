import { derive100zSrpRanges, RANGE_PROFILE_100Z_SRP } from './range-profile-100z.js';

const POSITIONS=new Set(['UTG','HJ','CO','BTN','SB','BB']);
const finite=v=>typeof v==='number'&&Number.isFinite(v);

export function parseOrderedMatchup(value){
  const m=String(value||'').toUpperCase().match(/^(UTG|HJ|CO|BTN|SB|BB)-VS-(UTG|HJ|CO|BTN|SB|BB)$/);
  if(!m||m[1]===m[2]) return null;
  return {heroPosition:m[1],villainPosition:m[2],positions:[m[1],m[2]]};
}

export function supported100zSrpPaths(matchup){
  const parsed=parseOrderedMatchup(matchup);
  if(!parsed) return [];
  const [a,b]=parsed.positions;
  const candidates=[
    {openerPosition:a,defenderPosition:b},
    {openerPosition:b,defenderPosition:a},
  ];
  const out=[];
  for(const row of candidates){
    if(!POSITIONS.has(row.openerPosition)||!POSITIONS.has(row.defenderPosition)) continue;
    const derived=derive100zSrpRanges(row);
    if(!derived.ok) continue;
    out.push({
      openerPosition:derived.openerPosition,
      defenderPosition:derived.defenderPosition,
      ipPosition:derived.ipPosition,
      oopPosition:derived.oopPosition,
      profileId:RANGE_PROFILE_100Z_SRP.profileId,
    });
  }
  return out;
}

function rootKey({openerPosition,defenderPosition,textureClass,sampleIndex}){
  return [RANGE_PROFILE_100Z_SRP.profileId,'100bb','srp',openerPosition,defenderPosition,String(textureClass),String(sampleIndex)].join('|');
}

export function solveRootCandidatesForStrategicTicket(ticket={}){
  const errors=[];
  if(ticket.lane!=='postflop-heads-up') errors.push('lane_not_postflop_heads_up');
  const axes=ticket.axes||{};
  if(Number(axes.effectiveStackBB)!==100) errors.push('starting_stack_not_100bb');
  if(String(axes.potType)!=='srp') errors.push('pot_type_not_srp');
  if(!['flop','turn','river'].includes(String(axes.street))) errors.push('street_invalid');
  const paths=supported100zSrpPaths(axes.positionMatchup);
  if(!paths.length) errors.push('range_path_unsupported');
  if(errors.length) return {ok:false,errors:[...new Set(errors)],roots:[]};
  const roots=paths.map(path=>({
    version:'cash-pro-lab-solve-root-candidate-v1',
    key:rootKey({...path,textureClass:axes.textureClass,sampleIndex:ticket.sampleIndex}),
    lane:'postflop-heads-up',
    startingStackBB:100,
    potType:'srp',
    openerPosition:path.openerPosition,
    defenderPosition:path.defenderPosition,
    ipPosition:path.ipPosition,
    oopPosition:path.oopPosition,
    textureClass:String(axes.textureClass),
    sampleIndex:Number(ticket.sampleIndex),
    sampleSeed:ticket.sampleSeed,
    strategyProfile:RANGE_PROFILE_100Z_SRP.profileId,
    covers:{
      streets:['flop','turn','river'],
      initiatives:['hero','villain','neutral'],
      facingClasses:['check','bet-small','bet-medium','bet-large','raise'],
    },
  }));
  return {ok:true,errors:[],roots};
}

export function planReusableSolveRoots(tickets,{maxTickets=Infinity}={}){
  if(!tickets||typeof tickets[Symbol.iterator]!=='function') throw new TypeError('tickets must be iterable');
  const roots=new Map();
  const rejectionCounts={};
  let seen=0,eligibleTickets=0,rootReferences=0;
  for(const ticket of tickets){
    if(seen>=maxTickets) break;
    seen++;
    const out=solveRootCandidatesForStrategicTicket(ticket);
    if(!out.ok){
      for(const reason of out.errors) rejectionCounts[reason]=(rejectionCounts[reason]||0)+1;
      continue;
    }
    eligibleTickets++;
    for(const root of out.roots){
      rootReferences++;
      const existing=roots.get(root.key);
      if(existing){
        existing.ticketReferences++;
        existing.splits[ticket.split]=(existing.splits[ticket.split]||0)+1;
        existing.splitGroupIds[ticket.splitGroupId||'missing']=(existing.splitGroupIds[ticket.splitGroupId||'missing']||0)+1;
        existing.heroPerspectives[ticket.axes?.positionMatchup]=(existing.heroPerspectives[ticket.axes?.positionMatchup]||0)+1;
      }else{
        roots.set(root.key,{
          ...root,
          ticketReferences:1,
          splits:{[ticket.split]:1},
          splitGroupIds:{[ticket.splitGroupId||'missing']:1},
          heroPerspectives:{[ticket.axes?.positionMatchup]:1},
        });
      }
    }
  }
  const list=[...roots.values()].sort((a,b)=>a.key.localeCompare(b.key));
  const splitLeakageRoots=list.filter(root=>Object.keys(root.splits).filter(k=>(root.splits[k]||0)>0).length>1);
  const splitGroupLeakageRoots=list.filter(root=>Object.keys(root.splitGroupIds).filter(k=>k!=='missing').length>1);
  const missingSplitGroupRoots=list.filter(root=>Object.hasOwn(root.splitGroupIds,'missing'));
  const valid=splitLeakageRoots.length===0&&splitGroupLeakageRoots.length===0&&missingSplitGroupRoots.length===0;
  return {
    version:'cash-pro-lab-solve-root-plan-v2',
    valid,
    ticketsSeen:seen,
    eligibleTickets,
    rootReferences,
    uniqueSolveRoots:list.length,
    compressionRatio:list.length?rootReferences/list.length:null,
    rejectionCounts,
    splitIntegrity:{
      leakageRoots:splitLeakageRoots.length,
      splitGroupLeakageRoots:splitGroupLeakageRoots.length,
      missingSplitGroupRoots:missingSplitGroupRoots.length,
      leakageRootKeys:splitLeakageRoots.slice(0,100).map(r=>r.key),
    },
    roots:list,
    note:'A solve root is not a completed study. One validated external solver tree may later yield many certified decision nodes. A valid plan requires every reusable root to belong to exactly one strategic split group so train/dev/holdout cannot share the same teacher tree.',
  };
}

export function estimateRootDecisionCoverage(root={}){
  const streets=Array.isArray(root?.covers?.streets)?root.covers.streets.length:0;
  const initiatives=Array.isArray(root?.covers?.initiatives)?root.covers.initiatives.length:0;
  const facing=Array.isArray(root?.covers?.facingClasses)?root.covers.facingClasses.length:0;
  const product=streets*initiatives*facing;
  return finite(product)?product:0;
}

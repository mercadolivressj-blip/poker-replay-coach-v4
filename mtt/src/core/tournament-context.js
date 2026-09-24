const num=(v,d=null)=>Number.isFinite(Number(v))?Number(v):d;
const text=v=>String(v??'').trim().toLowerCase();

export function normalizeTournamentContext(raw={}){
 const game=text(raw.game||'nlhe');
 const format=text(raw.format||'mtt');
 const bountyType=text(raw.bountyType||'none');
 const speed=text(raw.speed||'regular');
 const tableSize=num(raw.tableSize,8);
 const sb=Math.max(0,num(raw.smallBlind,0)),bb=Math.max(0,num(raw.bigBlind,0)),ante=Math.max(0,num(raw.ante,0));
 const nextSb=Math.max(0,num(raw.nextSmallBlind,0)),nextBb=Math.max(0,num(raw.nextBigBlind,0)),nextAnte=Math.max(0,num(raw.nextAnte,0));
 const out={
  game,format,tableSize,speed,
  tournamentName:String(raw.tournamentName||''),
  series:String(raw.series||''),
  bountyType,
  structure:{
   current:{smallBlind:sb,bigBlind:bb,ante,anteType:text(raw.anteType||'individual')},
   next:{smallBlind:nextSb,bigBlind:nextBb,ante:nextAnte},
   secondsToNextLevel:Math.max(0,num(raw.secondsToNextLevel,0)),
   level:num(raw.level,null)
  },
  field:{entrants:Math.max(0,num(raw.entrants,0)),remaining:Math.max(0,num(raw.remaining,0)),paidSpots:Math.max(0,num(raw.paidSpots,0))},
  flags:{classic:bountyType==='none',pko:bountyType==='pko',mystery:bountyType==='mystery'}
 };
 out.strategyIdentity=[game,format,`${tableSize}max`,speed,bountyType].join('|');
 return out;
}

export function contextReadiness(ctx){
 const problems=[];
 if(ctx.game!=='nlhe')problems.push('game_not_nlhe');
 if(ctx.format!=='mtt')problems.push('format_not_mtt');
 if(![6,7,8,9].includes(ctx.tableSize))problems.push('table_size_unsupported');
 if(!ctx.structure.current.bigBlind)problems.push('current_big_blind_missing');
 if(!['none','pko','mystery'].includes(ctx.bountyType))problems.push('bounty_type_unknown');
 return{ready:problems.length===0,problems};
}

// Tournament branding is metadata only. Strategy routing must depend on explicit
// attributes (NLHE, table size, speed, bounty, blinds/ante), never on names such
// as “Big”, “WCOOP” or “Thursday Thrill”.
export function strategyRoutingKey(ctx){return ctx.strategyIdentity}

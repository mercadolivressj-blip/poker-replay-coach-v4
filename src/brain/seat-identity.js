const clean=(v)=>String(v??'').replace(/\s+/g,' ').trim();
const canon=(v)=>clean(v).toLowerCase();
const VISUAL_LEFT=['hero','left-low','left-high','top','right-high','right-low'];
const VISUAL_RIGHT=['hero','right-low','right-high','top','left-high','left-low'];

export function parseMoneyLike(v){
  if(Number.isFinite(v)) return Number(v);
  const s=clean(v).replace(/[^0-9.,-]/g,'');
  if(!s) return null;
  const last=Math.max(s.lastIndexOf(','),s.lastIndexOf('.'));
  let normalized=s;
  if(last>=0){
    const head=s.slice(0,last).replace(/[.,]/g,'');
    const tail=s.slice(last+1);
    normalized=`${head||'0'}.${tail}`;
  } else normalized=s.replace(/[.,]/g,'');
  const n=Number(normalized);
  return Number.isFinite(n)?n:null;
}

function actorOf(row){return clean(row?.name??row?.player??row?.nick??row?.nickname??row?.actor);}
function visualOf(row){return clean(row?.captureSeatId??row?.visualSeat??row?.visualSlot??row?.slot);}
function stackOf(row){
  return parseMoneyLike(row?.stack??row?.stackValue??row?.chips??row?.balance??row?.amount);
}
function rotateFromHero(seats,heroActor=null){
  if(!Array.isArray(seats)||!seats.length) return [];
  let i=seats.findIndex((s)=>s?.isHero===true);
  if(i<0&&heroActor)i=seats.findIndex((s)=>canon(actorOf(s))===canon(heroActor));
  if(i<0)return [...seats];
  return [...seats.slice(i),...seats.slice(0,i)];
}

function greedyStackMatch(seats,localStacks,{absTolerance=.035,relativeTolerance=.03}={}){
  const candidates=[];
  for(const [slot,raw] of Object.entries(localStacks||{})){
    const local=parseMoneyLike(raw); if(local==null)continue;
    for(const row of seats||[]){
      const actor=actorOf(row),remote=stackOf(row); if(!actor||remote==null)continue;
      const diff=Math.abs(local-remote);
      const tol=Math.max(absTolerance,Math.max(local,remote)*relativeTolerance);
      if(diff<=tol)candidates.push({slot,actor,diff,tol,score:1-diff/Math.max(tol,1e-9)});
    }
  }
  candidates.sort((a,b)=>b.score-a.score||a.diff-b.diff);
  const map={},usedActors=new Set(),usedSlots=new Set(),evidence=[];
  for(const c of candidates){
    if(usedSlots.has(c.slot)||usedActors.has(c.actor))continue;
    // Ambiguous local stacks should not be force-matched. Require a reasonable gap
    // to the next candidate for the same slot when one exists.
    const rivals=candidates.filter(x=>x.slot===c.slot&&!usedActors.has(x.actor)&&x.actor!==c.actor);
    const next=rivals[0];
    if(next&&next.score>c.score-.18)continue;
    map[c.slot]=c.actor;usedSlots.add(c.slot);usedActors.add(c.actor);
    evidence.push({slot:c.slot,actor:c.actor,method:'stack-match',confidence:Math.max(.55,Math.min(.96,c.score))});
  }
  return {map,evidence};
}

export function resolveSeatIdentity(seats=[],{
  heroActor=null,
  localStacks={},
  orderedFromHero=false,
  orientation='left',
}={}){
  const rows=Array.isArray(seats)?seats.filter(Boolean):[];
  const map={},evidence=[];

  // 1) Explicit visual slot from metadata is sovereign for identity mapping.
  for(const row of rows){
    const slot=visualOf(row),actor=actorOf(row);
    if(!slot||!actor)continue;
    map[slot]=actor;evidence.push({slot,actor,method:'explicit-visual-slot',confidence:1});
  }

  // 2) Unique stack values can anchor visual slots without OCRing names.
  const stackMatched=greedyStackMatch(rows.filter(r=>!Object.values(map).includes(actorOf(r))),
    Object.fromEntries(Object.entries(localStacks||{}).filter(([slot])=>!map[slot])));
  Object.assign(map,stackMatched.map);evidence.push(...stackMatched.evidence);

  // 3) Some frozen metadata contracts return seats in table order. Only use this
  // when the caller explicitly declares the order semantics; never guess it.
  if(orderedFromHero){
    const ordered=rotateFromHero(rows,heroActor);
    const slots=orientation==='right'?VISUAL_RIGHT:VISUAL_LEFT;
    for(let i=0;i<Math.min(ordered.length,slots.length);i++){
      const actor=actorOf(ordered[i]); const slot=slots[i];
      if(!actor||map[slot]||Object.values(map).includes(actor))continue;
      map[slot]=actor;evidence.push({slot,actor,method:`ordered-from-hero:${orientation}`,confidence:.72});
    }
  }

  // Hero anchor is safe even when no other mapping is known.
  const heroRow=rows.find(s=>s?.isHero===true)||(heroActor?rows.find(s=>canon(actorOf(s))===canon(heroActor)):null);
  const hero=actorOf(heroRow)||clean(heroActor);
  if(hero&&!map.hero){map.hero=hero;evidence.push({slot:'hero',actor:hero,method:'hero-anchor',confidence:1});}

  const actors=rows.map(actorOf).filter(Boolean);
  const unresolvedActors=actors.filter(a=>!Object.values(map).some(v=>canon(v)===canon(a)));
  const unresolvedSlots=VISUAL_LEFT.filter(s=>!map[s]);
  const avg=evidence.length?evidence.reduce((n,e)=>n+(e.confidence||0),0)/evidence.length:0;
  return {version:'seat-identity-v1',map,evidence,unresolvedActors,unresolvedSlots,confidence:Number(avg.toFixed(3))};
}

export function seatIdentitySummary(identity){
  return Object.entries(identity?.map||{}).map(([slot,actor])=>`${slot}=${actor}`);
}

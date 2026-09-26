const STACKS=[20,30,40,50,75,100,150,200];
const POSITIONS=['UTG','HJ','CO','BTN','SB','BB'];
const POSTFLOP_STREETS=['flop','turn','river'];
const TEXTURES=['dry','paired','two-tone','monotone','connected','high-card','low-card','dynamic'];
const INITIATIVE=['hero','villain','neutral'];
const POSTFLOP_FACING=['check','bet-small','bet-medium','bet-large','raise'];
const HU_MATCHUPS=[
  'UTG-vs-BB','HJ-vs-BB','CO-vs-BB','BTN-vs-BB','SB-vs-BB',
  'BB-vs-UTG','BB-vs-HJ','BB-vs-CO','BB-vs-BTN','BB-vs-SB',
  'BTN-vs-CO','CO-vs-BTN','BTN-vs-SB','SB-vs-BTN','CO-vs-SB','SB-vs-CO',
  'HJ-vs-CO','CO-vs-HJ','UTG-vs-CO','CO-vs-UTG',
];

export const STRATEGIC_LANE_PLANS=Object.freeze({
  preflop:Object.freeze({
    samplesPerCell:500,
    axes:Object.freeze({
      effectiveStackBB:STACKS,
      heroPosition:POSITIONS,
      activePlayers:[2,3,4,5,6],
      facingClass:['unopened','limped','vs-open','vs-3bet','vs-4bet','vs-shove'],
    }),
  }),
  'postflop-heads-up':Object.freeze({
    samplesPerCell:6,
    axes:Object.freeze({
      effectiveStackBB:STACKS,
      street:POSTFLOP_STREETS,
      positionMatchup:HU_MATCHUPS,
      potType:['limped','srp','3bp','4bp'],
      initiative:INITIATIVE,
      facingClass:POSTFLOP_FACING,
      textureClass:TEXTURES,
    }),
  }),
  'postflop-multiway':Object.freeze({
    samplesPerCell:5,
    axes:Object.freeze({
      effectiveStackBB:STACKS,
      street:POSTFLOP_STREETS,
      heroPosition:POSITIONS,
      activePlayers:[3,4,5,6],
      potType:['limped','srp','3bp'],
      initiative:INITIATIVE,
      facingClass:POSTFLOP_FACING,
      textureClass:TEXTURES,
    }),
  }),
});

const fnv1a=(text)=>{
  let h=0x811c9dc5;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}
  return h>>>0;
};
const stable=value=>{
  if(Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
const product=axes=>Object.values(axes).reduce((n,values)=>n*values.length,1);
const POSITION_ORDER=new Map(POSITIONS.map((p,i)=>[p,i]));

function splitForHash(hash,split={train:80,dev:10,holdout:10}){
  const train=Number(split.train??80),dev=Number(split.dev??10),holdout=Number(split.holdout??10),total=train+dev+holdout;
  if(!(total>0)) throw new TypeError('split weights must sum above zero');
  const x=(hash%1000000)/1000000*total;
  if(x<train)return'train';if(x<train+dev)return'dev';return'holdout';
}

function* cartesian(entries,index=0,current={}){
  if(index>=entries.length){yield{...current};return;}
  const [key,values]=entries[index];
  for(const value of values){current[key]=value;yield* cartesian(entries,index+1,current);}
  delete current[key];
}

function resolvedPlans(overrides={}){
  const out={};
  for(const [lane,base] of Object.entries(STRATEGIC_LANE_PLANS)){
    const patch=overrides?.[lane]||{};
    const axes={...base.axes,...(patch.axes||{})};
    for(const [key,values] of Object.entries(axes)) if(!Array.isArray(values)||!values.length) throw new TypeError(`${lane}.${key} must be non-empty`);
    out[lane]={axes,samplesPerCell:patch.samplesPerCell??base.samplesPerCell};
    if(!Number.isInteger(out[lane].samplesPerCell)||out[lane].samplesPerCell<1) throw new TypeError(`${lane}.samplesPerCell invalid`);
  }
  return out;
}

function canonicalMatchupPair(value){
  const m=String(value||'').toUpperCase().match(/^(UTG|HJ|CO|BTN|SB|BB)-VS-(UTG|HJ|CO|BTN|SB|BB)$/);
  if(!m||m[1]===m[2]) return String(value||'');
  return [m[1],m[2]].sort((a,b)=>(POSITION_ORDER.get(a)??99)-(POSITION_ORDER.get(b)??99)).join('-');
}

export function strategicSplitGroupKey(lane,axes={},sampleIndex=0){
  if(lane==='preflop'){
    return stable({
      lane,
      effectiveStackBB:axes.effectiveStackBB,
      heroPosition:axes.heroPosition,
      activePlayers:axes.activePlayers,
      facingClass:axes.facingClass,
      sampleIndex,
    });
  }
  if(lane==='postflop-heads-up'){
    return stable({
      lane,
      effectiveStackBB:axes.effectiveStackBB,
      positionPair:canonicalMatchupPair(axes.positionMatchup),
      potType:axes.potType,
      textureClass:axes.textureClass,
      sampleIndex,
    });
  }
  if(lane==='postflop-multiway'){
    return stable({
      lane,
      effectiveStackBB:axes.effectiveStackBB,
      heroPosition:axes.heroPosition,
      activePlayers:axes.activePlayers,
      potType:axes.potType,
      textureClass:axes.textureClass,
      sampleIndex,
    });
  }
  return stable({lane,axes,sampleIndex});
}

export function strategicCurriculumManifest({plans={},seed='cash-pro-lab-strategic-v1',split={train:80,dev:10,holdout:10}}={}){
  const resolved=resolvedPlans(plans);
  const lanes={};let cells=0,tickets=0;
  for(const [lane,plan] of Object.entries(resolved)){
    const laneCells=product(plan.axes),laneTickets=laneCells*plan.samplesPerCell;
    lanes[lane]={cells:laneCells,samplesPerCell:plan.samplesPerCell,tickets:laneTickets,axes:plan.axes};
    cells+=laneCells;tickets+=laneTickets;
  }
  return {
    version:'cash-pro-lab-strategic-curriculum-v2',seed:String(seed),split,lanes,cells,tickets,
    splitUnit:'strategic-root-family',
    invariants:[
      'preflop has no board texture axis',
      'postflop-heads-up uses ordered position matchups but split isolation is by canonical position pair',
      'postflop-multiway starts at three active players',
      'street initiative and facing branches of the same postflop root family never cross train dev holdout',
      'hero/villain perspective reversals of the same heads-up root family never cross train dev holdout',
      'tickets are targets, never completed studies until exact-state proof and teacher EV audit pass',
    ],
  };
}

export function* iterateStrategicCurriculum({plans={},seed='cash-pro-lab-strategic-v1',split={train:80,dev:10,holdout:10},lanes=null}={}){
  const resolved=resolvedPlans(plans);
  const allowed=lanes?new Set(lanes):null;
  let ordinal=0;
  for(const [lane,plan] of Object.entries(resolved)){
    if(allowed&&!allowed.has(lane)) continue;
    for(const axes of cartesian(Object.entries(plan.axes))){
      const cellKey=stable({lane,axes});
      const cellId=`scell-${fnv1a(cellKey).toString(16).padStart(8,'0')}`;
      for(let sampleIndex=0;sampleIndex<plan.samplesPerCell;sampleIndex++){
        const sampleSeed=fnv1a(`${seed}|${cellKey}|${sampleIndex}`);
        const splitGroupKey=strategicSplitGroupKey(lane,axes,sampleIndex);
        const splitGroupSeed=fnv1a(`${seed}|split-group|${splitGroupKey}`);
        const splitGroupId=`sgroup-${splitGroupSeed.toString(16).padStart(8,'0')}`;
        yield {
          version:'cash-pro-lab-strategic-ticket-v2',ordinal:ordinal++,lane,teacherLane:lane,cellId,sampleIndex,sampleSeed,
          split:splitForHash(splitGroupSeed,split),splitGroupId,splitGroupSeed,axes:{...axes},
        };
      }
    }
  }
}

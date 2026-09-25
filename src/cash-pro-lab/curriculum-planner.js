const POSITIONS=['UTG','HJ','CO','BTN','SB','BB'];
const STREETS=['preflop','flop','turn','river'];
const DEFAULT_AXES={
  effectiveStackBB:[20,30,40,50,75,100,150,200],
  heroPosition:POSITIONS,
  street:STREETS,
  activePlayers:[2,3,4,5,6],
  potClass:['tiny','small','medium','large','spr-low','allin-pressure'],
  facingClass:['unopened','check','bet-small','bet-medium','bet-large','raise'],
  initiative:['hero','villain','neutral'],
  textureClass:['dry','paired','two-tone','monotone','connected','high-card','low-card','dynamic'],
};

const fnv1a=(text)=>{
  let h=0x811c9dc5;
  for(let i=0;i<text.length;i++){
    h^=text.charCodeAt(i);
    h=Math.imul(h,0x01000193)>>>0;
  }
  return h>>>0;
};
const stable=(value)=>{
  if(Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};

function normalizedAxes(axes={}){
  const merged={...DEFAULT_AXES,...axes};
  for(const [key,values] of Object.entries(merged)){
    if(!Array.isArray(values)||values.length===0) throw new TypeError(`axis ${key} must be a non-empty array`);
  }
  return merged;
}

export function curriculumCellCount(axes={}){
  return Object.values(normalizedAxes(axes)).reduce((n,values)=>n*values.length,1);
}

export function curriculumTicketCount({axes={},samplesPerCell=4}={}){
  if(!Number.isInteger(samplesPerCell)||samplesPerCell<1) throw new TypeError('samplesPerCell must be a positive integer');
  return curriculumCellCount(axes)*samplesPerCell;
}

function splitForHash(hash,split={train:80,dev:10,holdout:10}){
  const train=Number(split.train??80),dev=Number(split.dev??10),holdout=Number(split.holdout??10);
  const total=train+dev+holdout;
  if(!(total>0)) throw new TypeError('split weights must sum above zero');
  const x=(hash%1000000)/1000000*total;
  if(x<train) return 'train';
  if(x<train+dev) return 'dev';
  return 'holdout';
}

function* cartesianEntries(entries,index=0,current={}){
  if(index>=entries.length){yield {...current};return;}
  const [key,values]=entries[index];
  for(const value of values){
    current[key]=value;
    yield* cartesianEntries(entries,index+1,current);
  }
  delete current[key];
}

export function* iterateCurriculumTickets({axes={},samplesPerCell=4,seed='cash-pro-lab-v1',split}={}){
  if(!Number.isInteger(samplesPerCell)||samplesPerCell<1) throw new TypeError('samplesPerCell must be a positive integer');
  const entries=Object.entries(normalizedAxes(axes));
  let ordinal=0;
  for(const cell of cartesianEntries(entries)){
    const cellKey=stable(cell);
    const cellId=`cell-${fnv1a(cellKey).toString(16).padStart(8,'0')}`;
    for(let sampleIndex=0;sampleIndex<samplesPerCell;sampleIndex++){
      const sampleSeed=fnv1a(`${seed}|${cellKey}|${sampleIndex}`);
      yield {
        version:'cash-pro-lab-curriculum-ticket-v1',
        ordinal:ordinal++,
        cellId,
        sampleIndex,
        sampleSeed,
        split:splitForHash(sampleSeed,split),
        axes:{...cell},
      };
    }
  }
}

export function shardForTicket(ticket,shardCount){
  if(!Number.isInteger(shardCount)||shardCount<1) throw new TypeError('shardCount must be a positive integer');
  const key=`${ticket?.cellId||''}|${ticket?.sampleSeed??''}`;
  return fnv1a(key)%shardCount;
}

export function* iterateCurriculumShard(options={},shardIndex=0,shardCount=1){
  if(!Number.isInteger(shardIndex)||shardIndex<0||shardIndex>=shardCount) throw new RangeError('invalid shard index');
  for(const ticket of iterateCurriculumTickets(options)) if(shardForTicket(ticket,shardCount)===shardIndex) yield ticket;
}

export function curriculumManifest(options={}){
  const axes=normalizedAxes(options.axes||{});
  const samplesPerCell=options.samplesPerCell??4;
  return {
    version:'cash-pro-lab-curriculum-manifest-v1',
    axes,
    cells:curriculumCellCount(axes),
    samplesPerCell,
    tickets:curriculumTicketCount({axes,samplesPerCell}),
    seed:String(options.seed??'cash-pro-lab-v1'),
    split:options.split??{train:80,dev:10,holdout:10},
    note:'Tickets are curriculum targets, not solver-certified poker nodes. A ticket becomes a study only after node construction, Understanding Proof, domain-verified teacher consensus and EV audit.',
  };
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { HandMachine } from '../src/core/state-machine.js';
import { parseNumberText, parseRankText } from '../src/core/ocr.js';
import { PotConsensus } from '../src/detectors/pot.js';
import { recommend, analyzeMadeHand, analyzeDraws } from '../src/strategy.js';
import { reconcileTeacher } from '../src/core/teacher-merge.js';
import { VisionTeacher } from '../src/vision/teacher.js';
import handler from '../api/vision.js';

// Lifecycle + stale-write safety.
{
  const A=[0,0,0,0,0,0,0,0], B=[1,1,1,1,0,0,0,0];
  const m=new HandMachine();
  assert.equal(m.observeHero(A,true,1000).newHand,true); assert.equal(m.handId,1);
  assert.equal(m.setHero([{rank:'K'},{rank:'2'}],1),true); assert.equal(m.setPot(800,1),true);
  assert.equal(m.setActions([{type:'fold'},{type:'call'}],1),true); assert.equal(m.state.heroToAct,true);
  assert.equal(m.observeHero(B,true,1100).newHand,false);
  const r=m.observeHero(B,true,1180); assert.equal(r.newHand,true); assert.equal(r.reason,'hero-glyph-change'); assert.equal(m.handId,2);
  assert.deepEqual(m.state.hero,[]); assert.equal(m.state.pot,null); assert.equal(m.state.heroToAct,false);
  assert.equal(m.setHero([{rank:'A'},{rank:'A'}],1),false); assert.equal(m.setPot(9999,1),false);
  m.setBoard([{rank:'3'},{rank:'9'},{rank:'9'}],2); m.observeBoardCount(3,1400); m.observeBoardCount(0,1560);
  assert.equal(m.observeBoardCount(0,1640).newHand,true); assert.equal(m.handId,3);
  assert.equal(m.setBoardOccupancy(3,3),true); assert.equal(m.state.street,'flop');
  assert.equal(m.setBoardOccupancy(5,3),true); assert.equal(m.state.street,'river');
  assert.equal(m.setBoardOccupancy(0,3),true); assert.equal(m.state.street,'preflop');
}

// 80-generation soak.
{
  const m=new HandMachine(); let now=1000;
  const fp=(n)=>{const out=new Array(240).fill(0);for(let i=0;i<24;i++)out[(n*17+i*7)%120]=.8;for(let i=0;i<24;i++)out[120+(n*29+i*11)%120]=.8;return out};
  for(let h=1;h<=80;h++){
    const f=fp(h); let opened=false;
    if(h===1){opened=m.observeHero(f,true,now).newHand;now+=80}
    else if(h%4===0){for(let k=0;k<3;k++){m.observeHero(null,false,now);now+=80}opened=m.observeHero(f,true,now).newHand;now+=80}
    else if(h%4===1){m.setBoard([{rank:'3'},{rank:'9'},{rank:'T'}],m.handId);m.observeBoardCount(3,now);now+=80;m.observeBoardCount(0,now);now+=80;opened=m.observeBoardCount(0,now).newHand;now+=80;m.observeHero(f,true,now);now+=80}
    else {m.observeHero(f,true,now);now+=80;opened=m.observeHero(f,true,now).newHand;now+=80}
    assert(opened,`hand ${h}`); assert.equal(m.handId,h); m.setHero([{rank:'A'},{rank:'9'}],h); m.setPot(100+h*10,h); m.setActions([{type:'fold'},{type:'call',amount:20}],h); now+=220;
  }
}

// Parsers + pot consensus.
for(const [s,n] of [['2.700',2700],['3.068',3068],['.2.290',2290],['230.670',230670],['1.300',1300],['1.234,5',1234.5],['Pote: 2.457',2457]]) assert.equal(parseNumberText(s),n);
assert.equal(parseRankText('10'),'T'); assert.equal(parseRankText(' K '),'K');
{
  const p=new PotConsensus(); assert.equal(p.observe(800),null); assert.equal(p.observe(800),800); assert.equal(p.observe(799),null); assert.equal(p.observe(1300),null); assert.equal(p.observe(1300),1300);
}

// Strategy safety.
{
  const c=(rank,suit=null)=>({rank,suit}); const a3=[{type:'fold'},{type:'call',amount:100},{type:'raise',amount:400}];
  assert.equal(recommend({hero:[c('A','spades'),c('A','hearts')],board:[],street:'preflop',pot:300,actions:a3}).decision,'AUMENTAR');
  assert.equal(recommend({hero:[c('7'),c('2')],board:[],street:'preflop',pot:300,actions:a3}).decision,'DESISTIR');
  assert.equal(analyzeMadeHand([c('K'),c('K')],[c('Q'),c('7'),c('2')]).name,'overpair');
  assert.equal(analyzeMadeHand([c('A'),c('Q')],[c('Q'),c('7'),c('2')]).name,'top pair / par alto');
  assert.equal(analyzeDraws([c('A','clubs'),c('2','clubs')],[c('K','hearts'),c('8','hearts'),c('3','hearts'),c('5','hearts')]).flushDraw,false);
  const wait=recommend({hero:[c('A'),c('J')],board:[],street:'preflop',pot:2700,actions:[{type:'fold'},{type:'call',amount:null},{type:'raise',amount:null}]}); assert.equal(wait.decision,null); assert.match(wait.reason,/valor do call/i);
}

// Vision merge: never overwrite a confident local conflict.
{
  const local=[{rank:'A',suit:null,confidence:.9},{rank:'9',suit:null,confidence:.88}];
  let r=reconcileTeacher(local,[{rank:'A',suit:'clubs',confidence:.96},{rank:'9',suit:'hearts',confidence:.95}]); assert.equal(r.accepted,true);
  r=reconcileTeacher(local,[{rank:'4',suit:'clubs',confidence:.99},{rank:'9',suit:'hearts',confidence:.99}]); assert.equal(r.accepted,false);
}

// Vision Teacher dedupe + stale abort.
{
  const t=new VisionTeacher(); t.accessToken='abc123'; let calls=0; const oldFetch=global.fetch;
  global.fetch=async(_url,opts)=>{calls++;assert.equal(opts.headers['x-coach-token'],'abc123');return{ok:true,status:200,async json(){return{cards:[{rank:'A',confidence:.95},{rank:'9',confidence:.94}],confidence:.95}}}};
  const canvas={toDataURL(){return'data:image/jpeg;base64,AA=='}};
  assert(await t.read('hero',canvas,1,{expectedCount:2})); assert.equal(await t.read('hero',canvas,1,{expectedCount:2}),null); assert.equal(calls,1);
  let release; global.fetch=(_u,opts)=>new Promise((resolve,reject)=>{release=resolve;opts.signal?.addEventListener('abort',()=>{const e=new Error('aborted');e.name='AbortError';reject(e)},{once:true})});
  const oldRead=t.read('hero',canvas,2,{expectedCount:2}); await new Promise(r=>setTimeout(r,0)); t.resetHand(3); assert.equal(await oldRead,null); assert.equal(t.busy,false);
  if(oldFetch)global.fetch=oldFetch;else delete global.fetch;
}

// Server Vision endpoint contract uses GPT-5.6 Sol and keeps auth server-side.
{
  const makeRes=()=>({statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(v){this.body=v;return this}});
  const oldFetch=global.fetch, oldKey=process.env.OPENAI_API_KEY, oldToken=process.env.VISION_ACCESS_TOKEN; process.env.OPENAI_API_KEY='test-only'; process.env.VISION_ACCESS_TOKEN='secret-test'; let sent=null;
  global.fetch=async(_url,opts)=>{sent=JSON.parse(opts.body);return{ok:true,status:200,async json(){return{output_text:JSON.stringify({cards:[{rank:'A',suit:'spades',confidence:.97},{rank:'9',suit:'hearts',confidence:.96}],confidence:.96})}}}};
  let res=makeRes(); await handler({method:'POST',headers:{'x-coach-token':'secret-test'},body:{kind:'hero',image:'data:image/jpeg;base64,AA==',handId:7,expectedCount:2}},res);
  assert.equal(res.statusCode,200); assert.equal(sent.model,'gpt-5.6-sol'); assert.equal(sent.reasoning.effort,'low'); assert.equal(sent.text.format.schema.properties.cards.minItems,2);
  res=makeRes(); await handler({method:'POST',headers:{},body:{kind:'hero',image:'data:image/jpeg;base64,AA==',handId:9,expectedCount:2}},res); assert.equal(res.statusCode,401);
  if(oldFetch)global.fetch=oldFetch;else delete global.fetch; if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey; if(oldToken===undefined)delete process.env.VISION_ACCESS_TOKEN;else process.env.VISION_ACCESS_TOKEN=oldToken;
}

// Static/syntax smoke for every shipped JS module.
{
  const root=fileURLToPath(new URL('../',import.meta.url)); const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const text of ['Poker Replay Coach','V4 STANDALONE','Compartilhar replay','heroCards','boardCards','potValue','turnChip']) assert(html.includes(text),`UI missing ${text}`);
  const js=[]; const walk=(dir)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.isFile()&&p.endsWith('.js'))js.push(p)}}; walk(path.join(root,'src'));walk(path.join(root,'api'));
  for(const file of js){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(r.status,0,`${path.relative(root,file)} syntax: ${r.stderr}`);const src=fs.readFileSync(file,'utf8');for(const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)){const resolved=path.resolve(path.dirname(file),m[1]);assert(fs.existsSync(resolved),`${path.relative(root,file)} import missing ${m[1]}`)}}
  console.log(`static smoke: ${js.length} shipped JS modules`);
}

console.log('PUBLIC V4 regression suite passed');

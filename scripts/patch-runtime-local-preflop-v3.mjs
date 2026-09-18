import fs from 'node:fs';

const runtimePath='standalone-lab/study-runtime-public-v1.html';
let s=fs.readFileSync(runtimePath,'utf8');
const rep=(from,to,label)=>{if(!s.includes(from))throw new Error('missing '+label);s=s.replace(from,to)};

rep('<h2 style="margin:0">SSJ STUDY RUNTIME V1</h2>','<h2 style="margin:0">SSJ STUDY RUNTIME V1 · BUILD V3</h2>','build label');
rep("import { detectDealerButtonSeat, positionsFromDealer } from 'https://cdn.jsdelivr.net/gh/mercadolivressj-blip/poker-replay-coach-v4@e17c637c4364569d516bdf8626eeb801aafb13ac/src/core/dealer-button.js';",
"import { detectDealerButtonSeat, positionsFromDealer } from 'https://cdn.jsdelivr.net/gh/mercadolivressj-blip/poker-replay-coach-v4@e17c637c4364569d516bdf8626eeb801aafb13ac/src/core/dealer-button.js';\nimport { preflopDecision as localPreflopDecision } from 'https://cdn.jsdelivr.net/gh/mercadolivressj-blip/poker-replay-coach-v4@8acb701cc11b42a3a5ec4d13af899f7ff9269e00/src/brain/preflop.js';",
'local preflop import');

const old=`    const captureBatch=[...pendingCaptureEvents],seatMap=captureSeatMap();const r=await fetch(BRAIN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vision:effectiveState,context:{format:$('format').value,tableSize:'6max',handId:handSeq||null,preflopNode:node,versus,useStudySession:true,session:brainSession,captureEvents:captureBatch,captureSeatMap:seatMap}})}),j=await r.json();\n    if(!r.ok)throw Error(j.error||('HTTP '+r.status));if(j.session)brainSession=j.session;if(captureBatch.length)pendingCaptureEvents.splice(0,captureBatch.length);const d=j.result||{};`;
const neu=`    const captureBatch=[...pendingCaptureEvents],seatMap=captureSeatMap();\n    let d=null;\n    if(effectiveState.board.length===0){\n      d=localPreflopDecision(effectiveState,{format:$('format').value,tableSize:'6max',handId:handSeq||null,preflopNode:node,versus});\n      log('BRAIN LOCAL PREFLOP V3 · '+(d?.engine||'BRAIN GATE'));\n    }else{\n      const r=await fetch(BRAIN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vision:effectiveState,context:{format:$('format').value,tableSize:'6max',handId:handSeq||null,preflopNode:node,versus,useStudySession:true,session:brainSession,captureEvents:captureBatch,captureSeatMap:seatMap}})}),j=await r.json();\n      if(!r.ok)throw Error(j.error||('HTTP '+r.status));if(j.session)brainSession=j.session;if(captureBatch.length)pendingCaptureEvents.splice(0,captureBatch.length);d=j.result||{};\n    }`;
rep(old,neu,'brain local preflop dispatch');

rep("(async()=>{try{const r=await fetch(BRAIN),j=await r.json();const s=j.strategyStatus||{};$('backend').textContent=(j.service||'poker-strategy-brain')+' · '+(j.brainVersion||j.version||'online')+(s.postflop?' · '+s.postflop:'')}catch(e){$('backend').textContent='erro: '+e.message}render()})();",
"(async()=>{try{const r=await fetch(BRAIN),j=await r.json();const s=j.strategyStatus||{};$('backend').textContent='preflop-local-v3 · '+(j.service||'poker-strategy-brain')+' · '+(j.brainVersion||j.version||'online')+(s.postflop?' · '+s.postflop:'')}catch(e){$('backend').textContent='preflop-local-v3 · pós-flop remoto indisponível: '+e.message}render()})();",
'backend label');

fs.writeFileSync(runtimePath,s);
console.log('runtime local preflop V3 patched');

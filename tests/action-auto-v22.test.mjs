import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parsePokerStarsActionText } from '../src/brain/action-text.js';

const html=fs.readFileSync(new URL('../standalone-lab/study-runtime-auto-v22.html',import.meta.url),'utf8');
const ocr=fs.readFileSync(new URL('../src/core/action-ocr.js',import.meta.url),'utf8');

assert.match(html,/AUTO V22/);
assert.match(html,/actionOcr\.prewarm\(\)/);
assert.match(html,/actionOcr\.readFast\(crop\)/);
assert.match(html,/localActionLastTick<28/);
assert.match(html,/localOcrQueue=localOcrQueue\.filter/);
assert.match(html,/localStrategic>0\?rows/);
assert.match(html,/first\.p\.action==='ALLIN'\?\.80:\.68/);
assert.match(html,/class="assist" style="display:none"/);

assert.match(ocr,/async readFast\(/);
assert.match(ocr,/tessedit_pageseg_mode:'7'/);
assert.match(ocr,/if\(this\.busy\)return \{text:'',confidence:0,parsed:null,busy:true\}/);
assert.match(ocr,/One high-contrast pass only/);

const cases=[
  ['Passo','CHECK'],['Passa','CHECK'],['Pago US$ 0,24','CALL'],['Paga $0.75','CALL'],
  ['Aumento para US$ 0,80','RAISE'],['Aumenta 1,20','RAISE'],['Aposto 0,45','BET'],
  ['Desisto','FOLD'],['All-in','ALLIN'],['shove','ALLIN']
];
for(const [text,action] of cases)assert.equal(parsePokerStarsActionText(text)?.action,action,text);

const t0=performance.now();
for(let i=0;i<100000;i++)parsePokerStarsActionText(cases[i%cases.length][0]);
const ms=performance.now()-t0;
assert.ok(ms<1500,`text parser unexpectedly slow: ${ms.toFixed(1)}ms / 100k`);

console.log(`AUTO V22 integrity OK · parser ${ms.toFixed(1)}ms / 100k labels`);

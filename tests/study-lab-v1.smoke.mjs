import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../standalone-lab/study-runtime-v1.html',import.meta.url),'utf8');
assert(html.includes('SSJ STUDY RUNTIME V1'));
assert(html.includes("import { runStudyRuntime } from '../src/brain/study-runtime.js'"));
assert(html.includes('https://ssj-poker-hybrid-v1-r3-fast.vercel.app/api/vision/read'));
assert(!html.includes('id-preview--e06dd5f0-7e4c-44aa-a632-13a788f9bdd2.lovable.app'));
assert(html.includes('OBSERVED LEDGER'));
assert(html.includes('SOVEREIGN LEDGER'));
assert(html.includes('metadataObservedAt:lastMetadataObservedAt'),'lab must forward freshness marker into Study Runtime');
assert(html.includes('lastMetadataObservedAt=x.observedAt'),'full metadata read must stamp request-time freshness');
const m=html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert(m,'module script missing');
const body=m[1].replace(/^import .*;\s*$/gm,'');
new Function(body);
console.log('study-lab-v1 smoke: OK');

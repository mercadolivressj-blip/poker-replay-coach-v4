import c0 from './chunk-000.js';
import c1 from './chunk-001.js';
import c2 from './chunk-002.js';
import c3 from './chunk-003.js';
import c4 from './chunk-004.js';
import { brotliDecompressSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
let modulePromise;
async function loadBrain(){
  if(!modulePromise){
    const packed=[c0,c1,c2,c3,c4].join('');
    const source=brotliDecompressSync(Buffer.from(packed,'base64'));
    modulePromise=import('data:text/javascript;base64,'+source.toString('base64'));
  }
  return modulePromise;
}
export default async function handler(req,res){
  const mod=await loadBrain();
  return mod.default(req,res);
};
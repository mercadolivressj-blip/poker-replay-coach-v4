import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const root=fileURLToPath(new URL('../',import.meta.url));
const sourceDir=path.join(root,'src/strategy-v1/frozen-source');
const outDir=path.join(root,'src/strategy-v1/runtime');
const modules=[
  'cards.ts',
  'board-texture.ts',
  'action-history.ts',
  'poker-state.ts',
  'poker-math.ts',
  'hand-eval.ts',
  'hand-strength.ts',
  'postflop.ts',
  'postflop-decision.ts',
  'postflop-policy-features.ts',
  'postflop-policy.ts',
  'postflop-policy-decision.ts',
  'raise-mapping.ts',
];

const rewriteSpecifier=(spec)=>{
  if(!(spec.startsWith('./')||spec.startsWith('../'))) return spec;
  if(spec==='./postflop-policy-model.json') return '../postflop-policy-model.js';
  if(spec.endsWith('.ts')) return spec.slice(0,-3)+'.js';
  if(/\.(?:js|json|mjs|cjs)$/.test(spec)) return spec;
  return spec+'.js';
};

fs.rmSync(outDir,{recursive:true,force:true});
fs.mkdirSync(outDir,{recursive:true});

for(const file of modules){
  const input=path.join(sourceDir,file);
  let source=fs.readFileSync(input,'utf8');
  source=source.replace(
    /from\s+(["'])([^"']+)\1/g,
    (full,q,spec)=>`from ${q}${rewriteSpecifier(spec)}${q}`,
  );
  source=source.replace(
    /import\s+(["'])([^"']+)\1/g,
    (full,q,spec)=>`import ${q}${rewriteSpecifier(spec)}${q}`,
  );
  const js=stripTypeScriptTypes(source,{mode:'transform',sourceMap:false});
  const out=path.join(outDir,file.replace(/\.ts$/,'.js'));
  fs.writeFileSync(out,`// GENERATED from frozen source commit 3efde306fbb1dda38584cb8ffee0c2245b6231f4. Do not hand-edit.\n${js}\n`);
}

console.log(`Policy V4 runtime generated: ${modules.length} modules`);

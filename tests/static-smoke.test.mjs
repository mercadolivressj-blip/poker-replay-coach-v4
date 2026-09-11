import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const text of ['Poker Replay Coach', 'V4 STANDALONE', 'Compartilhar replay', 'coachTitle', 'heroCards', 'boardCards', 'potValue', 'turnChip'])
  assert(html.includes(text), `index.html missing ${text}`);

const jsFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.isFile() && p.endsWith('.js')) jsFiles.push(p);
  }
}
walk(path.join(root, 'src')); walk(path.join(root, 'api'));
for (const file of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${path.relative(root, file)} syntax: ${r.stderr}`);
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const resolved = path.resolve(path.dirname(file), m[1]);
    assert(fs.existsSync(resolved), `${path.relative(root, file)} import missing: ${m[1]}`);
  }
}
assert(fs.existsSync(path.join(root, 'styles.css')), 'styles.css missing');
assert(fs.existsSync(path.join(root, 'vercel.json')), 'vercel.json missing');
console.log(`static app smoke passed: ${jsFiles.length} JS modules syntax/imports + required UI shell`);

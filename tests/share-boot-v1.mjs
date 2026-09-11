import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../src/bootstrap.js', import.meta.url), 'utf8');
const guard = fs.readFileSync(new URL('../src/core/share-boot-guard.js', import.meta.url), 'utf8');

const mainAt = bootstrap.indexOf("await import('./main.js')");
const runtimeGuardsAt = bootstrap.indexOf("'./core/runtime-guards.js'");
const potRefinerAt = bootstrap.indexOf("'./vision/pot-refiner-runtime.js'");
assert(mainAt >= 0, 'main.js must be imported');
assert(runtimeGuardsAt > mainAt, 'capture/main path must load before optional runtime guards');
assert(potRefinerAt > mainAt, 'capture/main path must load before optional refiners');
assert.match(bootstrap, /try\s*\{[\s\S]*await import\('\.\/main\.js'\)/);
assert.match(bootstrap, /for \(const path of optionalModules\)/);
assert.match(guard, /Abrindo seletor/);
assert.match(guard, /Runtime não carregou/);
assert.match(guard, /capture: true/);

console.log('SHARE BOOT V1 regressions passed');

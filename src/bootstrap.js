import './core/share-boot-guard.js';

try {
  await import('./main.js');
  window.__prcMarkMainReady?.();
} catch (error) {
  console.error('[bootstrap:main]', error);
  window.__prcMarkMainError?.(error);
  throw error;
}

const optionalModules = [
  './core/runtime-guards.js',
  './vision/card-refiner-runtime.js',
  './vision/pot-refiner-runtime.js',
  './coach/coach-runtime.js',
  './coach/local-ui-bridge.js',
  './vision/local-action-runtime.js',
  './solver/resolver-runtime.js',
];

for (const path of optionalModules) {
  try {
    await import(path);
  } catch (error) {
    console.error(`[bootstrap:${path}]`, error);
  }
}

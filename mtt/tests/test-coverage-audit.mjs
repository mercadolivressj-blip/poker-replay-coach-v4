import assert from 'node:assert/strict';
import {clearPacks,registerPack} from '../src/strategy/pack-registry.js';
import {buildCoverageTargets,auditRegisteredCoverage,missingCoverageTargets} from '../src/strategy/coverage-audit.js';

clearPacks();
const targets=buildCoverageTargets({tableSizes:[8],depths:[20],nodes:['unopened'],modes:['cEV']});
assert.equal(targets.length,8);
let audit=auditRegisteredCoverage(targets);
assert.equal(audit.total,8);
assert.equal(audit.covered,0);
assert.equal(audit.missing,8);

const base={game:'NLHE',format:'MTT',mode:'cEV',tableSize:8,stackDepthBB:20,depthPolicy:'exact',node:'unopened',villainPosition:'*',source:'coverage synthetic fixture',sourceType:'synthetic-test',referenceDate:'2026-09-24',certification:'reference-only',actionSet:['FOLD','RAISE']};
registerPack({...base,heroPosition:'BTN'},{AKo:{RAISE:100}});
registerPack({...base,heroPosition:'CO'},{AKo:{RAISE:100}});
audit=auditRegisteredCoverage(targets);
assert.equal(audit.covered,2);
assert.equal(audit.missing,6);
assert.equal(audit.byPosition.BTN.covered,1);
assert.equal(audit.byPosition.CO.covered,1);
assert.equal(missingCoverageTargets(targets).length,6);

const bandTargets=buildCoverageTargets({tableSizes:[8],depths:[18,20,22],nodes:['vs_open'],modes:['cEV']}).filter(x=>x.heroPosition==='BB');
registerPack({...base,node:'vs_open',heroPosition:'BB',stackDepthBB:20,depthPolicy:'band',minEffectiveBB:18,maxEffectiveBB:22},{AKo:{RAISE:100}});
audit=auditRegisteredCoverage(bandTargets);
assert.equal(audit.total,3);
assert.equal(audit.covered,3);
assert.equal(audit.coveragePct,100);

console.log('PASS — MTT V0.3 coverage audit regressions');

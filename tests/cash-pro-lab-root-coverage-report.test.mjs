import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCurrentTeacherCoverageReport } from '../src/cash-pro-lab/root-coverage-report.js';

test('current teacher coverage report is exact, split-clean and honest about uncertified studies',()=>{
  const report=buildCurrentTeacherCoverageReport();
  assert.equal(report.curriculum.totalTickets,3139200);
  assert.equal(report.curriculum.huTickets,1382400);
  assert.ok(report.exactDomain.eligibleTickets>0);
  assert.ok(report.exactDomain.eligibleTickets<report.curriculum.huTickets);
  assert.ok(report.exactDomain.uniqueSolveRoots>0);
  assert.ok(report.exactDomain.compressionRatio>10);
  assert.equal(report.exactDomain.rootsBySplit.unknown,0);
  assert.equal(report.splitIntegrity.valid,true);
  assert.equal(report.splitIntegrity.leakageRoots,0);
  assert.equal(report.splitIntegrity.splitGroupLeakageRoots,0);
  assert.equal(report.claims.certifiedStudies,0);
  assert.equal(report.claims.solverTreesExecutedByThisReport,0);
  assert.ok(report.exactDomain.supportedPaths.length>0);
  console.log('CASH_PRO_LAB_COVERAGE_REPORT='+JSON.stringify(report));
});

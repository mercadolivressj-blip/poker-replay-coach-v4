import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRawArtifactSidecar,
  parseAndValidateRawSolverJson,
  resolveInside,
  sha256Hex,
  validateExternalSolverManifest,
  validateResumeArtifact,
} from '../scripts/lib/cash-pro-lab-external-solver.mjs';

const job={
  id:'cplroot-abc123',split:'train',commandFile:'commands/train/cplroot-abc123.txt',outputFile:'outputs/train/result.json',
  solverOutputBasename:'result.json',solveRootFingerprint:'cplroot-abc123',solveRootFingerprintVersion:'cash-pro-lab-solve-root-fingerprint-v1',
  strategyProfile:'100z-profile',treeProfileKey:'tree@1',
};
const manifest={version:'cash-pro-lab-external-solver-manifest-v1',campaign:{campaignId:'fixture'},jobs:[job]};
const raw=JSON.stringify({strategy:{node:'fixture'}});

test('raw solver envelope accepts a non-empty JSON object but never certifies semantics',()=>{
  const parsed=parseAndValidateRawSolverJson(raw);
  assert.equal(parsed.ok,true);
  const built=buildRawArtifactSidecar({job,rawText:raw,startedAt:'a',finishedAt:'b',exitCode:0,solverPath:'/solver/console_solver'});
  assert.equal(built.ok,true);
  assert.equal(built.sidecar.status,'RAW_SOLVER_ARTIFACT');
  assert.equal(built.sidecar.certifiedStudy,false);
  assert.equal(built.sidecar.validatedOracle,false);
  assert.equal(built.sidecar.sha256,sha256Hex(raw));
});

test('raw solver envelope rejects empty malformed or array JSON',()=>{
  assert.equal(parseAndValidateRawSolverJson('').ok,false);
  assert.equal(parseAndValidateRawSolverJson('{').ok,false);
  assert.equal(parseAndValidateRawSolverJson('[]').ok,false);
  assert.equal(parseAndValidateRawSolverJson('{}').ok,false);
});

test('resume requires exact job provenance and matching SHA-256',()=>{
  const built=buildRawArtifactSidecar({job,rawText:raw,startedAt:'a',finishedAt:'b',exitCode:0,solverPath:'/solver/console_solver'});
  assert.equal(validateResumeArtifact({job,rawText:raw,sidecar:built.sidecar}).ok,true);
  assert.equal(validateResumeArtifact({job:{...job,id:'other'},rawText:raw,sidecar:built.sidecar}).ok,false);
  assert.equal(validateResumeArtifact({job,rawText:JSON.stringify({strategy:{node:'changed'}}),sidecar:built.sidecar}).ok,false);
  assert.equal(validateResumeArtifact({job,rawText:raw,sidecar:{...built.sidecar,certifiedStudy:true}}).ok,false);
});

test('manifest validator rejects duplicate jobs, output collisions and unsafe solver output basenames',()=>{
  assert.equal(validateExternalSolverManifest(manifest).ok,true);
  const duplicate={...manifest,jobs:[job,{...job}]};
  const out=validateExternalSolverManifest(duplicate);
  assert.equal(out.ok,false);
  assert.ok(out.errors.some(e=>e.startsWith('duplicate_job_id:')));
  assert.ok(out.errors.some(e=>e.startsWith('duplicate_output_file:')));
  const unsafe=validateExternalSolverManifest({...manifest,jobs:[{...job,solverOutputBasename:'../result.json'}]});
  assert.equal(unsafe.ok,false);
  assert.ok(unsafe.errors.some(e=>e.startsWith('solver_output_basename_invalid:')));
});

test('campaign path resolver blocks absolute and parent traversal paths',()=>{
  assert.match(resolveInside('/tmp/campaign','outputs/train/a.json'),/campaign/);
  assert.throws(()=>resolveInside('/tmp/campaign','../escape.json'));
  assert.throws(()=>resolveInside('/tmp/campaign','/absolute.json'));
});

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
const commandText='set_pot 5.5\nstart_solve\ndump_result result.json\n';
const solverBinarySha256=sha256Hex(Buffer.from('fixture solver binary'));

function sidecar(overrides={}){
  return buildRawArtifactSidecar({
    job,rawText:raw,commandText,solverBinarySha256,startedAt:'a',finishedAt:'b',exitCode:0,solverPath:'/solver/console_solver',...overrides,
  });
}
function resume(overrides={}){
  const built=sidecar();
  return validateResumeArtifact({job,rawText:raw,commandText,solverBinarySha256,sidecar:built.sidecar,...overrides});
}

test('raw solver envelope accepts a non-empty JSON object but never certifies semantics',()=>{
  const parsed=parseAndValidateRawSolverJson(raw);
  assert.equal(parsed.ok,true);
  const built=sidecar();
  assert.equal(built.ok,true);
  assert.equal(built.sidecar.version,'cash-pro-lab-raw-solver-artifact-v2');
  assert.equal(built.sidecar.status,'RAW_SOLVER_ARTIFACT');
  assert.equal(built.sidecar.certifiedStudy,false);
  assert.equal(built.sidecar.validatedOracle,false);
  assert.equal(built.sidecar.sha256,sha256Hex(raw));
  assert.equal(built.sidecar.commandSha256,sha256Hex(commandText));
  assert.equal(built.sidecar.solverBinarySha256,solverBinarySha256);
});

test('raw solver envelope rejects missing command provenance or solver binary identity',()=>{
  assert.equal(sidecar({commandText:''}).ok,false);
  assert.equal(sidecar({solverBinarySha256:''}).ok,false);
});

test('raw solver envelope rejects empty malformed or array JSON',()=>{
  assert.equal(parseAndValidateRawSolverJson('').ok,false);
  assert.equal(parseAndValidateRawSolverJson('{').ok,false);
  assert.equal(parseAndValidateRawSolverJson('[]').ok,false);
  assert.equal(parseAndValidateRawSolverJson('{}').ok,false);
});

test('resume requires exact job output command tree strategy and binary provenance',()=>{
  assert.equal(resume().ok,true);
  assert.equal(resume({job:{...job,id:'other'}}).ok,false);
  assert.equal(resume({job:{...job,treeProfileKey:'tree@2'}}).ok,false);
  assert.equal(resume({job:{...job,strategyProfile:'other-profile'}}).ok,false);
  assert.equal(resume({job:{...job,outputFile:'outputs/train/other.json'}}).ok,false);
  assert.equal(resume({rawText:JSON.stringify({strategy:{node:'changed'}})}).ok,false);
  assert.equal(resume({commandText:`${commandText}# changed\n`}).ok,false);
  assert.equal(resume({solverBinarySha256:sha256Hex(Buffer.from('different binary'))}).ok,false);
  const built=sidecar();
  assert.equal(validateResumeArtifact({job,rawText:raw,commandText,solverBinarySha256,sidecar:{...built.sidecar,certifiedStudy:true}}).ok,false);
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

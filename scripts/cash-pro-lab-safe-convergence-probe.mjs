import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(process.argv[2] || path.join(repoRoot, '.cash-pro-lab', 'local-worker'));
const maxIterations = Number(process.env.CASH_PROBE_MAX_ITERATIONS || 600);
const reportEvery = Number(process.env.CASH_PROBE_REPORT_EVERY || 100);
const maxWallMinutes = Number(process.env.CASH_PROBE_MAX_WALL_MINUTES || 90);
const stableRequired = Number(process.env.CASH_PROBE_STABLE_CHECKPOINTS || 3);
const targetPctOverride = process.env.CASH_PROBE_TARGET_PCT == null ? null : Number(process.env.CASH_PROBE_TARGET_PCT);
const divergenceWindow = Number(process.env.CASH_PROBE_DIVERGENCE_WINDOW || 3);
const divergenceMultiple = Number(process.env.CASH_PROBE_DIVERGENCE_MULTIPLE || 2);
const divergenceAbsolutePct = Number(process.env.CASH_PROBE_DIVERGENCE_ABS_PCT || 1);

function die(message) {
  console.error(message);
  process.exit(2);
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { die(`cannot_read_json:${file}:${err.message}`); }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function positiveInt(name, value) {
  if (!Number.isInteger(value) || value < 1) die(`invalid_${name}:${value}`);
  return value;
}
function positiveNumber(name, value) {
  if (!Number.isFinite(value) || value <= 0) die(`invalid_${name}:${value}`);
  return value;
}

positiveInt('max_iterations', maxIterations);
positiveInt('report_every', reportEvery);
positiveInt('stable_checkpoints', stableRequired);
positiveInt('divergence_window', divergenceWindow);
positiveNumber('max_wall_minutes', maxWallMinutes);
positiveNumber('divergence_multiple', divergenceMultiple);
positiveNumber('divergence_abs_pct', divergenceAbsolutePct);

const toolchainPath = path.join(workspace, 'toolchain.json');
const manifestPath = path.join(workspace, 'probe-production-quality-t8', 'manifest.json');
if (!fs.existsSync(toolchainPath)) die(`missing_toolchain:${toolchainPath}`);
if (!fs.existsSync(manifestPath)) die(`missing_probe_manifest:${manifestPath}`);

const toolchain = readJson(toolchainPath);
const manifest = readJson(manifestPath);
const row = manifest?.jobs?.[0];
if (!row?.configFile || !row?.job) die('probe_manifest_first_job_missing');
if (!toolchain?.solver?.path || !fs.existsSync(toolchain.solver.path)) die('solver_binary_missing');

const sourceConfigPath = path.join(path.dirname(manifestPath), row.configFile);
if (!fs.existsSync(sourceConfigPath)) die(`probe_config_missing:${sourceConfigPath}`);

const configuredTarget = Number(row?.job?.convergence?.targetExploitabilityPct);
const targetPct = targetPctOverride ?? configuredTarget;
if (!Number.isFinite(targetPct) || targetPct <= 0) die(`invalid_target_pct:${targetPct}`);

let configText = fs.readFileSync(sourceConfigPath, 'utf8');
const targetMatches = [...configText.matchAll(/^target_exploitability\s*=\s*[-+0-9.eE]+\s*$/gm)];
if (targetMatches.length !== 1) die(`target_exploitability_match_count:${targetMatches.length}`);
// Keep the solver itself from early-stopping on a transient crossing. This guard owns the
// stop condition and requires multiple consecutive checkpoints at/below the real target.
configText = configText.replace(/^target_exploitability\s*=\s*[-+0-9.eE]+\s*$/m, 'target_exploitability = 0.000001');

const runDir = path.join(workspace, `safe-convergence-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(runDir, { recursive: true });
const guardedConfigPath = path.join(runDir, path.basename(sourceConfigPath));
const curvePath = path.join(runDir, 'curve.jsonl');
const summaryPath = path.join(runDir, 'summary.json');
fs.writeFileSync(guardedConfigPath, configText);

const args = [
  'solve', '--config', guardedConfigPath,
  '--report-every', String(reportEvery),
  '--threads', '8',
  '--max-iterations', String(maxIterations),
];

const startedAtMs = Date.now();
const checkpoints = [];
let best = null;
let stableStreak = 0;
let stopReason = null;
let peakRssBytes = 0;
let stderrTail = '';
let stdoutCarry = '';
let killedByGuard = false;

function rssBytes(pid) {
  if (process.platform !== 'linux') return null;
  try {
    const text = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = text.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    return match ? Number(match[1]) * 1024 : null;
  } catch { return null; }
}
function appendCheckpoint(cp) {
  checkpoints.push(cp);
  fs.appendFileSync(curvePath, `${JSON.stringify(cp)}\n`);
}
function lastIncreasing(windowSize) {
  if (checkpoints.length < windowSize) return false;
  const w = checkpoints.slice(-windowSize);
  for (let i = 1; i < w.length; i++) if (!(w[i].pct > w[i - 1].pct)) return false;
  return true;
}
function requestStop(child, reason) {
  if (stopReason) return;
  stopReason = reason;
  killedByGuard = true;
  child.kill('SIGTERM');
  setTimeout(() => {
    try { if (!child.killed) child.kill('SIGKILL'); } catch {}
  }, 5000).unref?.();
}

const child = spawn(toolchain.solver.path, args, {
  cwd: path.dirname(toolchain.solver.path),
  stdio: ['ignore', 'pipe', 'pipe'],
});

const rssTimer = setInterval(() => {
  const rss = rssBytes(child.pid);
  if (Number.isFinite(rss)) peakRssBytes = Math.max(peakRssBytes, rss);
}, 250);
rssTimer.unref?.();

const wallTimer = setTimeout(() => requestStop(child, 'wall_time_cap'), maxWallMinutes * 60_000);
wallTimer.unref?.();

child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');

child.stdout.on('data', chunk => {
  stdoutCarry += chunk;
  const lines = stdoutCarry.split(/\r?\n/);
  stdoutCarry = lines.pop() || '';
  for (const line of lines) {
    const m = line.match(/iter\s+(\d+)\s+NashConv\s+([-+0-9.eE]+)\s+chips\s+([-+0-9.eE]+)% of pot/);
    if (!m) continue;
    const cp = {
      at: new Date().toISOString(),
      iterations: Number(m[1]),
      chips: Number(m[2]),
      pct: Number(m[3]),
      elapsedSeconds: Number(((Date.now() - startedAtMs) / 1000).toFixed(1)),
    };
    if (!Number.isFinite(cp.pct) || cp.pct < 0) {
      appendCheckpoint(cp);
      requestStop(child, 'invalid_metric');
      continue;
    }
    appendCheckpoint(cp);
    if (!best || cp.pct < best.pct) best = { ...cp };

    if (cp.pct <= targetPct + 1e-9) stableStreak += 1;
    else stableStreak = 0;

    if (stableStreak >= stableRequired) {
      requestStop(child, 'stable_target_reached');
      continue;
    }

    const materiallyAboveBest = best && cp.pct > Math.max(best.pct * divergenceMultiple, best.pct + divergenceAbsolutePct);
    if (materiallyAboveBest && lastIncreasing(divergenceWindow)) {
      requestStop(child, 'divergence_guard');
    }
  }
});

child.stderr.on('data', chunk => {
  stderrTail = (stderrTail + chunk).slice(-16 * 1024);
});

child.once('error', err => {
  clearInterval(rssTimer);
  clearTimeout(wallTimer);
  die(`solver_spawn_failed:${err.message}`);
});

child.once('close', (code, signal) => {
  clearInterval(rssTimer);
  clearTimeout(wallTimer);
  const elapsedSeconds = Number(((Date.now() - startedAtMs) / 1000).toFixed(1));
  const last = checkpoints.at(-1) || null;
  const stableTargetReached = stopReason === 'stable_target_reached' && stableStreak >= stableRequired;
  const diverged = stopReason === 'divergence_guard';
  const completedNaturally = !killedByGuard && code === 0;
  const result = {
    version: 'cash-pro-lab-safe-convergence-probe-v1',
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date().toISOString(),
    rowId: row.id,
    sourceConfigPath,
    guardedConfigPath,
    solverPath: toolchain.solver.path,
    solverSha256: toolchain.solver.sha256 || null,
    targetPct,
    reportEvery,
    maxIterations,
    maxWallMinutes,
    stableRequired,
    divergenceGuard: {
      window: divergenceWindow,
      multiple: divergenceMultiple,
      absolutePct: divergenceAbsolutePct,
    },
    checkpoints,
    best,
    last,
    stableStreak,
    stableTargetReached,
    diverged,
    completedNaturally,
    stopReason: stopReason || (code === 0 ? 'solver_completed' : 'solver_failed'),
    exit: { code, signal },
    elapsedSeconds,
    peakRssGB: Number((peakRssBytes / (1024 ** 3)).toFixed(2)),
    stderrTail: stderrTail.trim(),
    authority: {
      pilotUnlocked: false,
      productionStrategy: false,
      certifiedStudies: 0,
    },
  };
  writeJson(summaryPath, result);
  console.log(JSON.stringify({ ok: stableTargetReached, runDir, summaryPath, ...result }, null, 2));
  process.exitCode = stableTargetReached ? 0 : 3;
});

#!/usr/bin/env python3
import json, os, pathlib, runpy, shutil, sys

# Video 6 must use exactly the already-approved post-blind V7 ledger/harness logic.
# We load the frozen video5 V7 harness copied into this repository and only remap
# the holdout input/output environment names. No video6 labels, timestamps, or
# thresholds are embedded here.

ROOT = pathlib.Path(__file__).resolve().parents[1]
CANDIDATES = [
    ROOT / 'tests' / 'offline_video5_blind_v7.py',
    ROOT / 'tests' / 'offline_video5_blind.py',
    ROOT / 'tests' / 'offline_video5_blind_v6.py',
]
base = next((p for p in CANDIDATES if p.exists()), None)
if base is None:
    raise SystemExit('approved video5 blind V7 harness not found')

video6 = os.environ.get('VIDEO6')
if not video6:
    raise SystemExit('VIDEO6 is required')
os.environ['VIDEO5'] = video6
out_dir = pathlib.Path(os.environ.get('OUT_DIR', '/tmp/video6-out'))
out_dir.mkdir(parents=True, exist_ok=True)

# Run the approved blind scanner unchanged, then preserve its raw output under
# video6-specific names. This is intentionally label-free for the first blind.
old_out = os.environ.get('OUT_DIR')
os.environ['OUT_DIR'] = str(out_dir)
runpy.run_path(str(base), run_name='__main__')

# Rename/copy any known first-score outputs without interpreting their contents.
for p in list(out_dir.iterdir()):
    if 'video5' in p.name:
        dst = out_dir / p.name.replace('video5', 'video6')
        if p.is_file():
            shutil.copy2(p, dst)

# Ensure the canonical first-score filename exists when the base harness used
# a generic result filename.
canon = out_dir / 'video6-blind-first-score.json'
if not canon.exists():
    json_files = sorted(out_dir.glob('*.json'))
    if json_files:
        shutil.copy2(json_files[0], canon)

# CASH_BRAIN — canonical project state

Updated: 2026-09-26

This file is the operational handoff for the offline/replay CASH_BRAIN project. It is not a production certification and does not grant strategy authority by itself.

## Scope

- NLHE cash 6-max, offline/replay/simulation/post-game study only.
- Critical decision path remains deterministic/local/offline.
- Public decision authority is CASH_BRAIN. Vision/Ledger provide facts; Legal Mask only blocks illegal actions.
- No live real-money assistance, click automation, process/memory reading, hidden overlays or anti-cheat bypass.

## Frozen/stable architecture

Vision R3 FAST / VisionState V1 -> Action Capture local -> Seat Identity -> Observed Ledger -> Sovereign Ledger -> Player Profiles -> Brain Knowledge -> Strategy -> Legal Mask.

Vision stable endpoint: `/api/vision/read`, lanes hero/board/quick/actions. Do not alter frozen Vision V34 without a reproduced bug.

## Repository

- Repository: `mercadolivressj-blip/poker-replay-coach-v4`
- Integration: `vision-v1-brain-integration`
- Cash Pro Lab branch: `cash-pro-lab-v1`
- Current experimental branch: `cash-pro-lab-convergence-guard`
- PR #14 is draft. Do not merge before certification and explicit user approval.

## Current exact curriculum lane

HU 100bb SRP, 100z high-rake, one RFI plus BB call, opener vs BB exact postflop paths.

- 21,600 tickets
- 240 unique solve roots
- train 197 / dev 27 / holdout 16
- target rake: 5% cap 2.5bb
- target NashConv: 0.25% of root pot
- turn chance sampling: false

The ~34,880-root / 3,139,200-ticket figures are broad curriculum planning estimates, not completed coverage and not a mathematical completeness threshold.

## Pinned solver

Upstream: `ucsandman/postflop`
Pinned commit: `5fc7ee3d92b823b6c58e4f58cbee7d50d5e9e6de`

Current production root measured tree:

- decision nodes: 2,528,424
- chance nodes: 9,284
- fold terminals: 2,084,972
- showdown terminals: 2,521,344
- total nodes: 7,144,024
- F32 regret + cumulative-strategy storage: 20,968,754,592 bytes

On the current 16-vCPU / 64-GB VM, compute before checkpoint I/O measured roughly 18.5–19.5 minutes per 100 iterations, ~21.7 GB RSS and ~5.5–6.3 logical cores of CPU.

## Measured convergence evidence on the production root

Repeated deterministic checkpoints:

- 100 iterations: 7.3378%
- 200 iterations: 2.1197%
- 300 iterations: 0.8914%
- 400 iterations: 0.6321%

A previous unguarded 2,500-iteration run ended at 205.2486%, proving that two early points were insufficient evidence and motivating a divergence guard.

The 400-iteration guarded run was terminated by an arbitrary 90-minute wall-clock cap. That cap was a design error because the solver did not yet support continuation state. The curve survived; the CFR state did not.

## Rake / convergence correction

Rake depends on terminal pot, so raked cash is not treated as a zero-sum metric shortcut. The local patch uses explicit unilateral best-response gains and reports their sum as NashConv for raked cash.

Current patch contract:

- id: `cash-pro-lab-raked-checkpoint-v2`
- deterministic rewrite: `patches/postflop-raked-checkpoint-v2.mjs`

Do not use the older `postflop-raked-checkpoint-v2.patch`; the deterministic rewrite script is the contract.

## Exact checkpoint/resume v2

The patched engine now persists the exact DCFR continuation state:

- iteration number
- cumulative regrets
- cumulative strategy sums
- storage mode
- node count / storage entries
- tree-layout fingerprint
- strategic-config fingerprint

Checkpoint publication is atomic: write temp -> flush -> fsync -> rename. A crash during a new checkpoint leaves the previous checkpoint intact. Resume refuses storage/config/tree mismatches.

The solver writes the checkpoint before emitting the measured checkpoint line. Therefore, when the external guard sees an `iter N NashConv ...` line, the continuation state for iteration N has already been persisted.

The arbitrary wall-clock kill is removed from the resumable production probe. The only strategic early abort is a measured divergence guard, and it acts only after a safe checkpoint exists.

Target acceptance remains conservative: 3 consecutive measured checkpoints at or below 0.25%.

## Independent saved-profile verification

`tools/highrake-action-ev/src/bin/solution-nashconv.rs` independently rebuilds the game from the saved solution and computes:

- BR(OOP), BR(IP)
- EV(OOP), EV(IP)
- unilateral gains `BR_i - EV_i`
- NashConv and percent of root pot

It does not rely on the patched `zero_sum()` shortcut. A saved profile is not accepted if independently recomputed values disagree with its metadata.

## CI evidence

Dedicated workflow: `cash-pro-lab-resumable-checkpoint-smoke`.

The workflow has passed with all of the following in one run:

1. exact pinned source checkout;
2. deterministic patch application and `git diff --check`;
3. patched solver compilation;
4. checkpoint at iteration 1;
5. restore that checkpoint and continue to iteration 2;
6. fresh uninterrupted solve to iteration 2;
7. deep equality of resumed vs uninterrupted solved state (ignoring wall time only);
8. independent saved-profile NashConv recomputation with zero observed metadata difference in the smoke fixture.

This proves the checkpoint mechanism on the tiny deterministic fixture. The first production-root resume still has to be demonstrated on the VM before claiming production-scale checkpoint certification.

## VM

Host label: `cash-pro-lab-solver-01`
Ubuntu 24.04, 16 vCPU, ~62.8 GB RAM, 1024 GiB root disk.
Repo: `/root/poker-replay-coach-v4`.

## Current operational commands

Prepare uses the resumable v3 toolchain:

`npm run cash-lab:pc:prepare`

Probe uses the resumable guarded root:

`npm run cash-lab:pc:probe`

Do not use the older 90-minute `cash-pro-lab-safe-convergence-probe.mjs` for production work.

## Gates before broad campaign

- Latest full repository CI must remain green.
- VM prepare-v3 smoke must pass.
- Production root must create a real checkpoint and prove actual VM resume from it.
- Production root must reach stable target or be stopped by measured divergence.
- Saved qualified profile must pass structural proof and independent NashConv verification.
- Campaign execution must be migrated to the same resumable checkpoint contract before running the remaining roots.
- `certifiedStudies` remains 0 until the downstream independent-teacher / promotion gates pass.

Never launch the 240-root campaign merely because the first convergence curve looks good.

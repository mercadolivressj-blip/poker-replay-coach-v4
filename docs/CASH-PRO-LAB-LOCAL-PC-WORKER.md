# Cash Pro Lab — Local PC Solve Worker

Purpose: run the 100bb SRP production solve campaign on a local PC for offline study only. This worker does not connect to a poker client, does not read a live table and does not modify the protected brain.

## Safety model

The local worker follows a hard sequence:

1. `preflight` — inspect CPU, RAM, free RAM, disk, Git and Cargo availability.
2. `prepare` — clone the external solver source, checkout the exact pinned commit and compile both the solver and the Cash Pro Lab per-action EV extractor.
3. `pilot` — solve exactly one real train root with the production strategic profile and 0.25% target exploitability. Only the compute thread count is reduced to 1 for the pilot; strategic ranges, rake, tree sizings, iteration ceiling and exploitability gate remain unchanged.
4. `campaign` — unlocked only after a validated pilot sidecar exists and the current machine still passes the local disk guard.

A file existing on disk is never enough to resume. Existing outputs are revalidated against the current solver-binary SHA-256, config SHA-256, exact provider fingerprint, convergence result and sidecar contract.

## Local workspace

All heavy outputs live under:

`.cash-pro-lab/local-worker/`

This path is ignored by Git. Solver source, compiled binaries, configs, solution JSON, logs, sidecars and checkpoints stay local unless deliberately exported later.

## Commands

From the repository root on branch `cash-pro-lab-v1`:

```bash
npm install
npm run cash-lab:pc:preflight
```

The preflight never solves anything.

When Git and Rust/Cargo are available:

```bash
npm run cash-lab:pc:prepare
```

This clones `https://github.com/ucsandman/postflop.git`, checks out exactly:

`5fc7ee3d92b823b6c58e4f58cbee7d50d5e9e6de`

and records SHA-256 for the compiled solver and EV extractor.

Then run exactly one production-quality pilot root:

```bash
npm run cash-lab:pc:pilot
```

Only if the pilot finishes as `VALIDATED_STRATEGY_ORACLE` (or a revalidated resume equivalent) does the worker unlock the campaign.

Full campaign:

```bash
npm run cash-lab:pc:campaign
```

The worker chooses a conservative thread recommendation capped at 8 logical threads and processes roots sequentially. To force a smaller batch:

```bash
npm run cash-lab:pc -- --mode campaign --max 5
```

To run only one split:

```bash
npm run cash-lab:pc -- --mode campaign --split train --max 10
```

To explicitly choose CPU threads:

```bash
npm run cash-lab:pc -- --mode campaign --threads 4
```

Changing threads creates a distinct provider fingerprint and campaign directory; it never silently overwrites evidence from another compute profile.

## Operational guards

The current conservative local guard requires at least 24 GB total RAM, 16 GB free RAM and 10 GB free disk before attempting the real pilot. These numbers are operational safety guards, not a claim that 24 GB guarantees a full-flop solve.

The full 240-root campaign additionally requires at least 100 GB free disk and a successfully validated production pilot on the same worker state. The real pilot result is the authority for whether the PC can build and solve this tree profile.

## Checkpoint / resume

Worker state:

`.cash-pro-lab/local-worker/worker-state.json`

Every validated root is written with exact evidence. If the process stops, rerunning the same command uses `resume:true`; a root is skipped only if its saved solution and sidecar revalidate against the exact current config and binary hashes.

The worker stops on the first root that is `FAILED` or `BLOCKED`. It does not continue producing a mixed-quality campaign after a validation failure.

## Authority boundary

A successful local solve produces a **validated strategy oracle root**, not a certified study.

It does **not** automatically mean:

- per-action alternative EV is available for every decision node;
- independent teacher consensus exists;
- a decision is safe for Challenger training;
- a Challenger may be promoted;
- the production brain may be changed.

The downstream steps remain: per-action EV extraction → teacher artifact → independent-teacher consensus for high-impact nodes → classroom EV audit → train-only learning → frozen paired holdout → human review.

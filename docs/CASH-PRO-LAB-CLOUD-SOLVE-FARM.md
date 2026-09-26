# Cash Pro Lab — Cloud Solve Farm

## Purpose

Run the external postflop solver offline on dedicated compute for Cash Pro Lab study/certification. This is not a live-play or real-money assistance path.

## First production machine

Recommended first pilot shape:

- Ubuntu 24.04 x64
- 8 dedicated vCPU
- 64 GiB RAM
- >= 200 GiB SSD/NVMe
- on-demand / non-preemptible for the first production pilot

The machine shape is not authority. The first full production root must complete and validate before the campaign is unlocked.

If the 64 GiB pilot is externally killed or runs out of memory, increase the machine to 128 GiB. Do not reduce ranges, tree profile, rake contract, or exploitability target merely to fit smaller hardware.

## Bootstrap

On a fresh Ubuntu VM:

```bash
curl -fsSL https://raw.githubusercontent.com/mercadolivressj-blip/poker-replay-coach-v4/cash-pro-lab-v1/scripts/cash-pro-lab-bootstrap-ubuntu.sh -o /tmp/cash-pro-lab-bootstrap.sh
bash /tmp/cash-pro-lab-bootstrap.sh
```

The bootstrap installs build prerequisites, Node 22.x when needed, Rust stable when needed, clones `cash-pro-lab-v1`, installs project dependencies, and runs the guarded hardware preflight.

It does **not** start a production solve.

## Guarded stages

From the repository directory:

```bash
npm run cash-lab:pc:prepare
npm run cash-lab:pc:pilot
```

`prepare`:

- checks out the exact pinned solver source commit;
- builds the solver locally;
- builds the action-EV extractor;
- records SHA-256 of the resulting binaries;
- grants no poker-strategy authority by itself.

`pilot`:

- materializes one real train root at frozen production quality;
- runs exactly one full-flop production solve;
- validates config hash, solver binary hash, root provenance, solution schema and convergence;
- writes a resumable sidecar only if validation passes;
- unlocks the production campaign only after success.

## Production campaign

Only after the pilot passes:

```bash
npm run cash-lab:pc:campaign
```

The worker processes train first, then dev, then holdout. Each completed root is revalidated on resume. A stale/malformed output is recomputed instead of trusted.

The worker stops on the first job that does not validate.

## Authority boundary

A completed external solve is initially a **validated strategy oracle**, not a certified Cash Pro Lab study.

Certification still requires:

1. exact strategic-node mapping;
2. per-action EV extraction where required;
3. Understanding Proof;
4. independent teacher-family requirements for high-impact nodes;
5. EV audit;
6. paired holdout for challenger promotion;
7. human review before any promotion.

`certifiedStudies` remains zero until those gates are satisfied.

## Cost discipline

Do not estimate the 240-root campaign from guesswork. Measure the first production root. Record wall time, peak memory if available, output size and convergence. Then estimate the remaining compute from measured evidence.

Destroy or power down paid cloud compute when it is not solving. Keep campaign outputs on persistent storage until they are ingested and backed up.

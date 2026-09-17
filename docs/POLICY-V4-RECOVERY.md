# Policy V4 — Recovery Ledger

Status: **exact frozen artifact and source recovered; active runtime parity gated**.

This ledger records both the failed recovery search and the final recovered provenance so Strategy V1 cannot silently drift or be reconstructed from approximations.

## Frozen identity

- Policy: `postflop-policy-v4`
- Certified model SHA-256: `bb98bc8a27ec4bb634ff380ec1315c3bc4cc7605a81a65ce0ece2848a4e27181`
- Lossless recovered artifact byte SHA-256: `d0e45d38963d77c0833b468d1f5dcf47f817347f4a7e6bce7c1431fa1b0bd573`
- Frozen source project: `Hero Card Rescue`
- Frozen source project ID: `a4352431-0461-41cd-bebc-1e1e617a190c`
- Frozen source commit: `3efde306fbb1dda38584cb8ffee0c2245b6231f4`
- Vendored artifact entrypoint: `src/strategy-v1/postflop-policy-model.js`
- Artifact encoding: lossless JS chunks under `src/strategy-v1/postflop-policy-model/`
- Frozen source modules: `src/strategy-v1/frozen-source/`

## Recovery result

The exact model payload was recovered losslessly and is reconstructed by `postflop-policy-model.js`. The artifact gate verifies:

- version `postflop-policy-v4`;
- certified embedded model hash;
- recovered raw-byte transport hash;
- 74 features;
- 400 trees/iterations;
- classes `CHECK / BET / CALL / FOLD / RAISE`.

The frozen TypeScript strategy modules were also recovered and are transformed into an isolated JS runtime by `scripts/generate-policy-v4-runtime.mjs`. The generated runtime is not hand-authored strategy logic.

## Final Decision Layer V4 semantics

The recovered final source is authoritative over older historical notes.

- mixed strategy threshold: top-two allowed actions less than or equal to 10 percentage points apart;
- legal-action mask applies to the primary and mixed secondary action;
- low model support does **not** replace an in-distribution legal Policy V4 action with a heuristic;
- the older 45% minimum-support fallback is historical audit context only and was removed in the final frozen source;
- fallback remains for out-of-distribution / insufficient nuclear state / no legal policy action, and multiway remains outside the trained heads-up authority.

See `docs/POLICY-V4-MIGRATION-TRUTH.md` and the frozen oracles in `tests/oracles/policy-v4/`.

## Active parity gates

The branch keeps `policyComplete=true` only while the exact-port gates remain green:

1. `tests/strategy-v1-policy-artifact.test.mjs` — recovered model identity and byte integrity;
2. `tests/strategy-v1-frozen-source-integrity.test.mjs` — exact Git-blob integrity for all 13 recovered frozen-source modules;
3. `tests/strategy-v1-policy-port.test.mjs` — 74-feature ordering, inference, legal masking, OOD and final low-support semantics;
4. `tests/strategy-v1-policy-adapter.test.mjs` — Brain adapter / ledger history / replay-facing semantics;
5. `tests/strategy-v1-postflop-gate.test.mjs` — active Brain path and sovereign external legal mask;
6. frozen source oracles under `tests/oracles/policy-v4/`.

The Brain manifest must fail closed if these assumptions are no longer true. Do not silently replace the frozen model or source with a retrained/reconstructed approximation.

## Historical recovery search

Before the exact source was recovered, searches were performed across the default branch, replay/coach feature branches, Git history, PR discussions, Actions artifacts, Library handoffs, historical ZIP exports, Vercel deployments and connected Drive locations. Those searches initially found only certification metadata and aggregate metrics, not a model payload.

Historical clues included an approximately 4.5 MB model, PokerBench training/evaluation filenames, Policy V4 audit reports, and the recorded certified hash. Those clues were useful for provenance but were explicitly **not** treated as enough to recreate the Gradient Boosting model.

A real replay diagnostic also confirmed historical runtime decisions labeled `engine: "POLICY V4"`, but diagnostics contain decisions rather than model bytes and were never used as a substitute for exact recovery.

## Hard rules

- Do not retrain or rebuild Policy V4 from reported hyperparameters/metrics and call it parity.
- Do not alter the recovered frozen source as an optimization.
- Do not bypass the sovereign legal-action mask.
- Do not describe the model as GTO-perfect, solver-perfect, universal or best-in-world.
- Certified label remains: **ELITE VALIDADO PARA ACTION-SELECTION NO ESCOPO POKERBENCH**.
- Product scope remains replay/simulation/post-game study only.

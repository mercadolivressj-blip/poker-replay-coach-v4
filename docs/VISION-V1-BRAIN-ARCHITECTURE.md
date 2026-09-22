# Vision V1 + External Strategy Brain

## Goal

Keep the validated Lovable reader as the **eyes** and move all poker strategy work to this GitHub/Vercel codebase.

## Ownership boundary

### Lovable — Vision V1 (FROZEN)
Owns perception only:
- hero cards / presence
- board / presence
- pot
- hero stack / effective stack / blinds
- legal actions / toCall
- players / seats / action history / position metadata
- confidence / reader model diagnostics

It does **not** own strategy, ranges, policy, recommendation text, or future decision changes.

### ChatGPT + GitHub/Vercel — Strategy Brain
Owns:
- preflop ranges and deterministic nodes
- postflop analysis / policy / legal action mapping
- pot odds / SPR / depth / blocker and texture logic
- strategy versions and regression tests
- recommendation and explanation output
- every future strategy change

## Stable contract

The boundary is `VisionState v1` (`vision-v1`). Both sides must keep this shape stable.

The GitHub validator lives at `src/core/vision-contract.js`.
The brain ingress lives at `POST /api/brain`.

## Strategy migration status

Do **not** connect the old standalone heuristic `src/strategy.js` to Vision V1. It is simpler than the validated Strategy V1 and would be a regression.

The frozen Strategy V1 / Policy V4 stack has now been recovered and exact-port gated in this branch:

- exact Policy V4 artifact recovered with immutable model and transport hashes;
- frozen postflop source recovered from the recorded Hero Card Rescue commit;
- 74-feature / 400-tree runtime generated from frozen source;
- final Decision Layer V4 semantics regression-gated;
- Policy V4 is the active postflop Brain path for covered heads-up states;
- sovereign external legal-action masking remains mandatory.

`policyComplete` is therefore `true` on this integration branch. See `docs/POLICY-V4-RECOVERY.md` and `docs/STRATEGY-V1-PORT-MANIFEST.md`.

MTT/ICM remains a separate approximation-only module and is **not** covered by the Policy V4 certification. See `docs/MTT-ICM-AUDIT.md`.

## Safety against regressions

- `main` stays untouched until parity is proven.
- all work happens on branch `vision-v1-brain-integration`.
- vision changes are out of scope.
- the recovered Strategy V1 port remains protected by artifact, frozen-source, adapter and active-runtime regression gates.
- MTT/ICM cannot be promoted beyond approximation without independent source/provenance and oracle coverage.

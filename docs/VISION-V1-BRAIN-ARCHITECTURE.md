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

## Migration rule

Do **not** connect the old standalone heuristic `src/strategy.js` to Vision V1. It is simpler than the validated Strategy V1 and would be a regression.

The next milestone is an **exact port** of the validated deterministic Strategy V1 / Policy V4 stack from the frozen Lovable project into this branch. Only after parity tests pass should `/api/brain` return a real decision.

## Safety against regressions

- `main` stays untouched until parity is proven.
- all work happens on branch `vision-v1-brain-integration`.
- vision changes are out of scope.
- a Strategy V1 port must be tested against the frozen audit fixtures before being connected to live VisionState input.

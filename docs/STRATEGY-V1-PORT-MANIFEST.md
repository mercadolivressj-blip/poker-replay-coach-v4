# Strategy V1 exact-port manifest

Source of truth: frozen `Hero Card Rescue` project (`a4352431-0461-41cd-bebc-1e1e617a190c`), frozen source commit `3efde306fbb1dda38584cb8ffee0c2245b6231f4`.

The old standalone `src/strategy.js` is **not** authoritative and must not be connected to Vision V1.

## Ported / frozen components

- [x] cash preflop baseline `cash6max-100z-highrake-v1` — regression-gated;
- [x] `poker-state.ts`;
- [x] `poker-math.ts`;
- [x] `board-texture.ts`;
- [x] `hand-eval.ts`;
- [x] `hand-strength.ts`;
- [x] `postflop.ts`;
- [x] `postflop-policy-features.ts`;
- [x] exact Policy V4 model payload, transported losslessly as JS chunks;
- [x] `postflop-policy.ts`;
- [x] `postflop-policy-decision.ts`;
- [x] `postflop-decision.ts`;
- [x] `raise-mapping.ts`;
- [x] action-history / ledger bridge needed by the external Brain.

Recovered frozen sources live under `src/strategy-v1/frozen-source/`. The isolated JS runtime is generated from those sources by `scripts/generate-policy-v4-runtime.mjs`.

## Required behavior parity

The active port is gated to preserve:

- deterministic preflop baseline decisions for covered cash 6-max ~100bb nodes;
- explicit awaiting-state behavior instead of inventing an action when nuclear metadata is incomplete;
- Strategy V1 → Policy V4 → Decision Layer V4 postflop chain;
- sovereign legal-action masking, including both actions in a mixed recommendation;
- no implicit conversion of generic raise to short-stack all-in;
- exact 74-feature order and missing-value semantics;
- frozen Policy V4 model identity and artifact bytes;
- final frozen low-support semantics: no historical 45% fallback for an in-distribution legal policy action;
- mixed strategy when the top two allowed actions are within 10pp;
- frozen heuristic fallback only for the recovered fallback domains, including multiway/OOD/insufficient state.

## Integration status

- VisionState v1 validator: **DONE**
- `/api/brain` ingress: **DONE**
- Cash preflop frozen baseline port: **DONE / regression-gated**
- Real replay fixture and actor/order/street/seat/hand-transition regressions: **DONE**
- Provisional → sovereign one-to-one confirmation and sticky sizing ambiguity: **DONE**
- Integrated Study Runtime / lab freshness gates: **DONE**
- Exact Policy V4 artifact recovery: **DONE**
- Frozen Policy V4 source recovery: **DONE**
- Isolated Policy V4 JS runtime: **DONE**
- Brain Policy V4 adapter: **DONE**
- Decision Layer V4 final semantics: **DONE / regression-gated**
- Active postflop Brain path: **POLICY V4**
- `policyComplete`: **true**
- Multiway: frozen deterministic fallback / professional approximation
- MTT/ICM: **approximation; independent audit still pending**

## Integrity gates

- `tests/strategy-v1-policy-artifact.test.mjs`
- `tests/strategy-v1-frozen-source-integrity.test.mjs`
- `tests/strategy-v1-policy-port.test.mjs`
- `tests/strategy-v1-policy-adapter.test.mjs`
- `tests/strategy-v1-postflop-gate.test.mjs`
- frozen migration oracles under `tests/oracles/policy-v4/`

Any future change that invalidates exact artifact/source identity or the recovered final semantics must fail closed rather than silently retaining the `active-frozen-policy-v4` label.

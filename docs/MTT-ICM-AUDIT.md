# MTT / ICM audit — current truth

Status: **approximation only; not chart-certified, not ICM-certified, not solver-certified**.

This audit documents what the replay-study Brain currently does for tournament preflop spots. It does not promote the existing heuristics to a certified strategy.

## Current implementation

### `src/brain/preflop.js`

For `context.format !== "cash"`, the Brain uses a hand-authored MTT approximation:

- a relative hand-strength score;
- stack-depth buckets;
- position adjustments;
- approximate short-stack thresholds;
- legacy position ranges in uncovered cases;
- an optional externally supplied `icmRiskPremiumPct` that increases the continuation threshold in some facing-action spots.

Missing preflop history is **not** treated as proof that the pot is unopened. With empty history, the Brain requires an explicit confirmed `preflopNode: "rfi"` (or equivalent `node`) before applying first-in thresholds; otherwise it returns an insufficient-state gate.

Every MTT result is tagged:

- `certification: "approximation-only"`
- `chartCertified: false`
- `icmCertified: false`
- `solverCertified: false`

Engine labels retain `APROXIMAÇÃO`.

### `src/brain/mtt-context.js`

This module provides tournament context only. It is **not an ICM solver**.

When `icmRiskPremiumPct` is supplied explicitly, that number is preserved and marked `riskPremiumSource: "explicit-external-context"`. This records provenance but does not certify the upstream calculator.

Without an explicit number, the module uses phase heuristics:

- bubble: 8%;
- final table: 10%;
- in the money: 3%;
- otherwise: 0%.

Those values are marked `riskPremiumSource: "phase-heuristic"` and must not be described as calculated ICM risk premiums.

Important: the phase heuristic from `mtt-context.js` is not silently injected into the current MTT preflop decision path. `preflop.js` only applies an ICM risk-premium adjustment when `context.icmRiskPremiumPct` is explicitly present. This prevents an estimated phase number from masquerading as an externally calculated ICM input.

## What is not certified

The repository currently has no recovered, independently verified source artifact for:

- tournament opening charts by stack depth;
- tournament response-to-open / 3-bet / 4-bet charts;
- push/fold Nash tables;
- bounty/PKO ranges;
- satellite ranges;
- final-table ranges;
- payout-aware ICM equilibrium;
- FGS;
- a solver model or solver-produced decision table covering these nodes.

Therefore none of the existing MTT thresholds may be relabeled as solver, Nash, GTO or ICM-certified.

## Certification requirements

Changing `STRATEGY_V1_MANIFEST.mtt.status` requires evidence, not tuning.

At minimum, a future certified module needs:

1. identified source/dataset and immutable version/hash;
2. explicit tournament format and assumptions;
3. stack-depth coverage;
4. positions and action-node coverage;
5. payout/bounty assumptions where applicable;
6. exact legal-action semantics;
7. deterministic fixture/oracle set;
8. independent regression tests;
9. documented out-of-distribution behavior;
10. no fallback labeled as certified strategy.

Until those gates exist, the correct public/runtime status remains:

`approximation-only-not-certified`.

## Regression gate

`tests/mtt-icm-audit.test.mjs` verifies:

- manifest status stays uncertified;
- heuristic vs explicit risk-premium provenance remains distinct;
- an explicit risk premium does not imply solver/ICM certification;
- short-stack MTT recommendations retain `APROXIMAÇÃO`;
- Brain and API expose the uncertified status;
- missing action history cannot silently become an unopened/RFI node.

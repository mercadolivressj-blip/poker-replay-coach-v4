# SSJ Cash Pro Lab V0.1

Offline/replay-only laboratory for turning the Cash Brain into a more professional decision engine without touching the stable runtime or frozen vision.

## Goals

1. Model opponent ranges as a belief that changes with line, street and sizing.
2. Learn player tendencies slowly with shrinkage toward population priors.
3. Refuse exploitative adjustments on tiny samples.
4. Audit decisions by EV regret, not by whether the hand won or lost.
5. Add independent confidence gates around expensive river and stack-off aggression.
6. Stress-test against multiple strong synthetic opponent styles before any field validation.

## V0.1 modules

- `opponents.mjs`: synthetic strong archetypes (balanced, tight, aggro, LAG, tricky, station, nit).
- `player-model.mjs`: Bayesian-style Beta shrinkage model with minimum sample protection.
- `range-belief.mjs`: line-conditioned range groups updated by street, action, sizing, draw completion and blockers.
- `regret.mjs`: action-EV regret measurement.
- `confidence-gate.mjs`: terminal aggression and exploit gates.
- `simulator.mjs`: deterministic synthetic player-learning harness.
- `tests/test-cash-pro-lab.mjs`: regressions including a K3-like river failure pattern.

## Non-goals in V0.1

- This is not yet a full solver.
- Archetype frequencies are stress-test fixtures, not claims about a real player pool.
- Range-group likelihoods are controlled lab priors, not certified population data.
- No click automation, no real-time assistance, no process/memory reading, no anti-cheat bypass.

## Next milestones

- V0.2: combo-level NLHE range representation and blocker removal.
- V0.3: street-by-street action likelihood calibration and sizing families.
- V0.4: adversarial river/stack-off scenario generator.
- V0.5: independent EV auditor and per-street regret dashboard.
- V0.6: player identity/profile persistence for post-game study.
- Later: connect only to replay telemetry and compare against the frozen Cash Brain as an independent auditor.

## Architecture rule

The lab is separate from the Cash runtime. A lab result cannot automatically change the production brain. Promotion requires deterministic regression evidence and replay validation.

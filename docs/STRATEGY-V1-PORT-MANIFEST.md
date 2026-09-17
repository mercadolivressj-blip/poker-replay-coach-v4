# Strategy V1 exact-port manifest

Source of truth: frozen `Poker Vision Gateway` Lovable clone, commit lineage validated on 2026-09-17.

The old standalone `src/strategy.js` is **not** authoritative and must not be connected to Vision V1.

## Strategy modules to port exactly

- [ ] `poker-state.ts`
- [ ] `poker-math.ts`
- [ ] `ranges-100z.data.ts`
- [ ] `ranges-100z.ts`
- [ ] `ranges-6max.ts`
- [ ] `preflop-decision.ts`
- [ ] `preflop-context.ts` / resolver pieces required by production
- [ ] `confirmed-state.ts` decision metadata gate only
- [ ] `board-texture.ts`
- [ ] `hand-eval.ts`
- [ ] `hand-strength.ts`
- [ ] `postflop.ts`
- [ ] `postflop-policy-features.ts`
- [ ] `postflop-policy-model.json`
- [ ] `postflop-policy.ts`
- [ ] `postflop-policy-decision.ts`
- [ ] `postflop-decision.ts`
- [ ] `raise-mapping.ts`

## Required behavior parity

The port is not considered connected until it reproduces:

- deterministic preflop baseline decisions for covered cash 6-max ~100bb nodes;
- explicit `ANALISANDO`/awaiting state instead of inventing an action when metadata is incomplete;
- Strategy V1 → Policy V4 postflop chain;
- sovereign legal-action masking;
- no implicit conversion of generic raise to short-stack all-in;
- stable mixed-strategy selection from `decisionKey`;
- exact audit fixtures / regression tests from the frozen source.

## Integration status

- VisionState v1 validator: DONE
- `/api/brain` ingress: DONE (accepts/normalizes state, deliberately emits no strategy yet)
- Strategy V1 exact port: IN PROGRESS
- Live Vision V1 → Strategy V1 decision: BLOCKED until parity tests pass

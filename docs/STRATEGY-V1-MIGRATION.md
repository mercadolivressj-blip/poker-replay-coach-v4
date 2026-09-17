# STRATEGY V1 — MIGRATION TO GITHUB/VERCEL

Source of truth currently frozen in Hero Card Rescue (`a4352431-0461-41cd-bebc-1e1e617a190c`).

## Frozen certification

- Preflop: `cash6max-100z-highrake-v1`
- Postflop policy: `postflop-policy-v4`
- Frozen model sha256: `bb98bc8a27ec4bb634ff380ec1315c3bc4cc7605a81a65ce0ece2848a4e27181`
- Decision layer: V4
- Minimum policy support: 45%
- Mixed strategy threshold: <= 10 percentage points
- Scope caveats remain exactly as frozen: multiway is professional approximation; depth outside 90–110bb has reduced confidence.

## Migration rule

The first external Strategy V1 must be a **behavior-preserving port**, not an improvement. No range, threshold, policy weight, chart, decision rule or fallback may change during migration.

Only after parity tests pass may a new `Strategy V2` branch change strategy.

## Source modules to vendor from the frozen project

Primary decision chain:

- `src/lib/preflop-decision.ts`
- `src/lib/preflop-resolver.ts`
- `src/lib/preflop-context.ts`
- `src/lib/ranges-6max.ts`
- `src/lib/ranges-100z.ts`
- `src/lib/ranges-100z.data.ts`
- `src/lib/postflop.ts`
- `src/lib/postflop-decision.ts`
- `src/lib/postflop-policy-decision.ts`
- `src/lib/postflop-policy.ts`
- `src/lib/postflop-policy-features.ts`
- `src/lib/postflop-policy-model.json`
- `src/lib/hand-strength.ts`
- `src/lib/hand-eval.ts`
- `src/lib/board-texture.ts`
- `src/lib/poker-math.ts`
- `src/lib/poker-state.ts`
- `src/lib/raise-mapping.ts`

Integration/state modules required for parity will be added only when a migrated module imports them.

## Contract boundary

Strategy consumes a normalized `VisionState v1` plus deterministic context. It must never consume crops, prompts, screenshots, model names, or Lovable-specific internals.

```text
VisionState v1
  -> deterministic state/context
  -> preflop baseline OR postflop analysis/policy
  -> legal-action mask
  -> Recommendation v1
```

## Acceptance gates before calling the migration complete

1. Frozen preflop regression fixtures unchanged.
2. Frozen postflop policy model checksum unchanged.
3. Legal-action mask parity.
4. Mixed-strategy threshold parity (10pp).
5. Strategy regression suite passes with no changed expected decisions.
6. Vision code is not imported by strategy modules.

Until those gates pass, the migrated engine is `strategy-v1-migration`, not production Strategy V1.

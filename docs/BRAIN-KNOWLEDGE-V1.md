# BRAIN KNOWLEDGE V1

## Ownership

- Lovable Vision V1 is **eyes only**.
- GitHub/Vercel owns state, memory, strategy, player models and decisions.
- No strategy call may be delegated to Lovable.

## Knowledge snapshot

`src/brain/knowledge.js` builds a deterministic `brain-knowledge-v1` snapshot from confirmed `VisionState v1`, Action Ledger and optional Player Profiles.

It exposes:

- street;
- Hero cards, position, stack and effective stack;
- effective depth in BB;
- blinds, pot, to-call and legal actions;
- active-player count and multiway flag;
- pot odds / required equity;
- SPR and SPR regime;
- preflop aggressor and last aggressor;
- latest aggression on the current street;
- whether Hero is facing a bet;
- current-street action sequence;
- postflop hand class, relative strength, board texture and draws;
- cautious opponent metrics/labels when a profile has enough sample;
- explicit completeness/missing-data flags.

## Sources

### Frozen hot-path eyes

The stable R3 baseline continuously reads only:

1. Hero cards;
2. Board;
3. Quick state (pot / Hero stack / blinds);
4. Hero legal actions / to-call.

These four lanes must remain independent and must not be changed merely to add strategy context.

### Metadata / action context

`VisionState v1` can also carry:

- players / activePlayers;
- heroPosition;
- effectiveStack;
- seats;
- actionHistory.

Those fields are optional. If a reliable producer has not supplied them, Brain Knowledge marks them as missing. It must not infer a villain action from Hero legal-action buttons.

`actionHistory` is parsed by Action Ledger V1 into chronological actions with actors and streets. The ledger deduplicates repeated snapshots and derives PFA / last aggressor.

## Session memory

`Study Session V1` owns hand lifecycle and Player Profiles. `/api/brain` supports a stateless `session` round-trip:

- request: `{ vision, context: { useStudySession: true, session } }`
- response: `{ result, session }`

The client can persist the returned session (for example in memory/localStorage) and send it back on the next decision. This avoids hidden server state and any Lovable storage dependency.

## Opponent profiles

Player Model V1 accumulates observed data such as VPIP, PFR, 3-bet and postflop aggression. Labels are conservative:

- fewer than 30 hands: `SEM AMOSTRA`;
- 30–99 hands: low confidence;
- 100+ hands: at most medium confidence in V1.

Profiles are context, not permission to override the frozen baseline. Exploit rules require their own audited policy before changing decisions.

## Strategy migration status

Frozen certification known from the migration record:

- preflop: `cash6max-100z-highrake-v1`;
- postflop policy target: `postflop-policy-v4`;
- model SHA-256: `bb98bc8a27ec4bb634ff380ec1315c3bc4cc7605a81a65ce0ece2848a4e27181`;
- Decision Layer: V4;
- minimum policy support: 45%;
- mixed-strategy threshold: <= 10 percentage points.

The Policy V4 source/model is **not currently vendored in GitHub**. Therefore the runtime is correctly labeled `strategy-v1-migration`; the current postflop fallback is provisional and must never be presented as Policy V4.

## Invariants

1. Bad/inconclusive vision never erases confirmed state.
2. Legal-action mask is sovereign.
3. Missing context is reported, not guessed.
4. Player reads require sample size.
5. Lovable never decides.
6. Policy V4 is not claimed active until source + model checksum + parity tests pass.

# BRAIN KNOWLEDGE V1

Brain Knowledge V1 is the external normalized context snapshot consumed by the replay-study brain. It is deliberately separated from Lovable vision internals.

## What the brain can know

The snapshot may contain:

- hero cards and board;
- street;
- hero position;
- hero/effective stack and effective depth in BB;
- blinds;
- pot and to-call;
- legal actions;
- pot odds and required equity;
- SPR;
- player count / active-player count and multiway status;
- chronological action ledger;
- preflop aggressor, last aggressor, and current-street last aggression;
- hand class, relative hand strength, board texture, and draw analysis;
- persistent player reads from Study Session V1 / Player Model V1;
- explicit completeness flags listing missing context.

## Action evidence sources

Action history can be assembled from independently trustworthy sources and merged chronologically:

- `visionHistory` from event-triggered metadata reads;
- `handHistoryText` from PokerStars replay/hand-history text;
- `manualActionHistory` for study fixtures and controlled tests.

Fast visual seat events are handled separately by **Action Capture V1**. Action Capture V1 samples local seat regions at high frequency and emits evidence candidates such as `seat-change` and `fold-candidate`. These candidates are **not sovereign actions** and do not enter Action Ledger as confirmed FOLD/CALL/BET/RAISE events until reconciled with a trustworthy source. This prevents a transient animation or visual false positive from contaminating strategy state.

Action Capture V1 also maintains a short rolling frame ring so a fast 1–2 second event can be preserved for later reconciliation even when remote vision is slower.

## Strategy boundary

Knowledge is context, not authority. Player reads and local visual candidates must not silently mutate the frozen strategy baseline. Strategy V1 migration status remains explicit in `strategy-manifest.js`.

- frozen cash preflop baseline: ported and regression-gated;
- frozen postflop Policy V4 source/model: not vendored in GitHub yet;
- MTT/ICM: approximation only until separately audited.

## Runtime invariants

1. Missing information is represented as missing, never guessed.
2. Legal actions remain sovereign at the final decision boundary.
3. Local visual candidates are evidence only until confirmed.
4. Session memory can be round-tripped through `/api/brain` without hidden server state.
5. No strategy decision is delegated to Lovable.

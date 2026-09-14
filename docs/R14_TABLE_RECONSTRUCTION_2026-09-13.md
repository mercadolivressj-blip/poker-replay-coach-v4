# R14 — Table reconstruction contract — 2026-09-13

## Product rule

`LEITURA INSUFICIENTE` is a safety state, not the normal product outcome.

The Poker Replay Coach is expected to reconstruct the public replay table as completely as the recording allows: seats, Hero seat, dealer/button, positions, blinds, current-street commitments, stacks, fold state, visible actions, pot, street/board and current decision context.

When one frame is weak or contradictory, the Coach may temporarily abstain from strategy, but it must preserve trustworthy same-hand evidence, keep observing the replay and automatically recover as soon as the missing public evidence is confirmed.

The safety rule remains binding: never fabricate a poker action just to avoid an insufficient-reading state.

## R14 temporal table memory

Implemented on `feature/state-transaction-r14`:

- stable same-hand seat identity survives a weak frame;
- Hero seat and dealer/button remain bound during the physical hand once confirmed;
- a temporarily unreadable nickname can be restored from same-hand evidence;
- an entirely missing seat may survive for up to two weak frames as `memoryOnly` evidence;
- `visibleAction` is never carried from memory;
- current-street commitment may be preserved through a weak frame, but never across a street transition;
- a confirmed fold remains folded for the rest of the same hand;
- memory resets atomically on a new hand generation.

This is intentionally state reconstruction, not looser strategy gating. The Coach should know more because it uses temporal evidence better, not because confidence thresholds were weakened.

## Regression coverage

`tests/table-state-tracker-v1.mjs` now covers:

1. Hero/dealer/nickname continuity through a degraded frame.
2. Missing-seat memory without fabricated action text.
3. No commitment leakage from preflop into flop.
4. Fold irreversibility inside one physical hand.

GitHub Actions run #835 completed successfully on commit `05435fa2458e4491c6aa0e1d102e5ed1845ae3fd`.

## Next replay validation

On the next recorded replay, classify every failure separately as:

- perception/read error;
- table reconstruction/timeline error;
- hand lifecycle/generation error;
- strategy error;
- explanation/didactic error.

The target is not to eliminate `LEITURA INSUFICIENTE` at any cost. The target is for it to appear only when the recording genuinely does not yet provide enough trustworthy public evidence, and to disappear automatically once that evidence is reconstructed.

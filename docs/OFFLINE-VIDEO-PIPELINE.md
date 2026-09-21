# SSJ Poker AUTO — offline video gate

This branch treats fixed-layout PokerStars 1280x720 recordings as an engineering dataset for replay/simulation/post-session analysis. The gate is deliberately conservative: missing evidence blocks the Brain instead of being guessed.

## Datasets

### Session 1 — baseline/training

- Recording: `2026-09-20 22-25-57.mkv`
- 1280x720, 30 FPS, 1027.633 s
- Ground truth: `session-2026-09-20-ground-truth-v2.json`
- 23 confirmed hands
- 47 physical Hero decision windows
- 85 reconstructed actions, 0 UNKNOWN, 47/47 complete decision histories
- Video regression: Hero 47/47, buttons 47/47, positions 23/23, stack holdout 47/47, pot holdout 3/3, `toCall` 47/47

The old 24-hand/45-decision timeline came from random OpenCV seeking and is obsolete. Official regressions decode sequentially by frame index. The known false split around 868.5 s remains a locked regression.

### Session 2 — independent generalization, then regression

- Recording: `2026-09-21 11-49-44.mkv`
- 1280x720, 30 FPS, 553.033 s
- Ground truth: `session-2026-09-21-ground-truth-v1.json`
- 14 hands / 31 Hero decisions
- Action history complete: 31/31
- Generalization gate: buttons 31/31, positions 14/14, Hero holdout 30/30, board 58/58, stack 31/31, pot holdout 30/30, `toCall` 31/31
- `toCall`: 29 direct fixed-ROI reads + 2 resolved from seat-state/stack delta; 0 from button OCR

The blind pass was completed before manual labels. Two post-blind calibrations are explicitly excluded from their holdouts: Hero rank `6` at decision 3 and pot-font `0.08` at decision 12. No video-2 board labels or commitment labels train their respective readers in the official two-session runner.

## Fixed reader architecture

1. Hero: two fixed independent card slots.
2. Board: five fixed independent slots; presence and rank/suit decoding are separate.
3. Hero and board use context-separated card template banks.
4. Stack, pot and commitment use context-separated numeric evidence.
5. Commitments require a fixed `US$ + value` layout; generic table text is rejected.
6. Dealer detection requires the actual PokerStars button signature: approximately 30x25 white disc with a red star, not generic red/white blobs.
7. Dealt-in seats come from card backs/faces and are frozen near hand start.
8. Position is derived once from dealer + frozen dealt-in seats and cannot change after folds.
9. Opponent turn uses the yellow/green panel progress bar only as evidence; action state changes remain authoritative.
10. Action ledger combines cards, commitments, stack, expected order and street transitions. Transient `Pago/Desisto/Aumento` text is corroboration only.
11. Commitment resolution priority: fixed ROI numeric → persisted seat-ledger commitment → street stack delta → BLOCK.
12. `toCall = max(active commitments) - Hero commitment`; button OCR/time-bank text is never a price source.
13. Physical Hero action buttons confirm the Hero decision window; pre-action checkboxes do not.
14. Snapshot Validator + `seat-state-ledger-v1` must both be complete before the Brain can run.

## Hard Brain gate

The Brain is blocked unless Hero has two valid unique cards, board count is exactly 0/3/4/5 with no decode gap, the physical Hero turn is confirmed, buttons are physical/legal, position is frozen from dealer + dealt-in seats, pot/stack/`toCall` are finite and consistent, `toCall` comes from seat state, and the action ledger is complete with zero unresolved actions.

A bad read should become an abstention/BLOCK. It must never be converted into a plausible-looking recommendation.

## Important locked regressions

- `50,69` must never become `0,69`.
- `40,78` must never become `0,78`.
- Board count 5 with only 4 decoded cards is BLOCKED.
- Hero time bank/button text cannot become `toCall`.
- A visible stack/panel does not imply dealt-in.
- A fold cannot change Hero position mid-hand.
- `CHECK` is invalid if the player still owes chips relative to table max.
- Hand 22 in session 1 remains continuous across the historical 868.5 s visual gap.
- Session 2 hands 6 and 12 have dealer `LT` and Hero `HJ`; these lock the strict dealer-button detector.

## Release battery

```bash
python3 tests/offline_video_regression.py "/path/to/2026-09-20 22-25-57.mkv"
python3 tests/offline_video_generalization.py "/path/to/2026-09-20 22-25-57.mkv" "/path/to/2026-09-21 11-49-44.mkv"
npm test
```

`offline_video_regression.py` protects the baseline session. `offline_video_generalization.py` runs one forward sequential pass per recording and protects cross-session behavior. See `offline-generalization-gate-report-v1.json` for the frozen metrics.

No new runtime/release should be produced until all three commands are green. Passing these two recordings is evidence of materially better generalization, not a claim of universal perfection.

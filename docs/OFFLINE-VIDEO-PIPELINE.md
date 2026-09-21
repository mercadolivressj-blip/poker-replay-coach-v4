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
- With the current parser, `toCall` resolves 28 directly from fixed commitment ROIs and 3 from persisted seat state / stack delta; 0 from button OCR.

The blind pass was completed before manual labels. Two post-blind calibrations are explicitly excluded from their holdouts: Hero rank `6` at decision 3 and pot-font `0.08` at decision 12. No video-2 board labels or commitment labels train their respective readers in the official two-session runner.

### Session 3 — blind continuity/stress generalization

- Recording: `2026-09-21 13-32-02.mkv`
- 1280x720, 30 FPS, 693.6 s
- Ground truth: `session-2026-09-21-video3-ground-truth-v1.json`
- Action gate: `session-2026-09-21-video3-action-gate-v1.json`
- 19 hands / 40 physical Hero decisions
- One legitimate BB walk (`Ah 8d`) with no Hero decision; all five opponent folds are reconstructed
- Post-fix source-video gate: buttons 40/40, Hero cards 40/40, board 63/63, Hero stack 40/40, pot 40/40, `toCall` 40/40, positions 19/19
- Decision history complete: 40/40
- Hand continuity: 19/19
- 129 reconstructed action events in the audited continuity ledger
- 26 fast folds recovered from stable seat-card disappearance when the turn-band was too brief

The blind pass did **not** pass perfectly. Decision 11 exposed one critical bug: an opponent commitment `US$1.20` was parsed without its clipped leading `1`, producing `toCall=0.20` instead of the true `1.10`. The parser now has a decimal-row fallback that recovers 1–3 integer digits even when the `US$` prefix is clipped. After that generic fix, sessions 1, 2 and 3 were rerun without source-video regression. The original blind miss stays recorded in ground truth and in `offline-three-session-gate-report-v1.json`.

## Fixed reader architecture

1. Hero: two fixed independent card slots.
2. Board: five fixed independent slots; presence and rank/suit decoding are separate.
3. Hero and board use context-separated card template banks.
4. Stack, pot and commitment use context-separated numeric evidence.
5. Commitments prefer the fixed `US$ + value` layout, with a conservative decimal-row fallback for clipped prefixes; generic table text is rejected.
6. Dealer detection requires the actual PokerStars button signature: approximately 30x25 white disc with a red star, not generic red/white blobs.
7. Dealt-in seats come from card backs/faces and are frozen near hand start.
8. Position is derived once from dealer + frozen dealt-in seats and cannot change after folds.
9. Physical Hero action buttons are authoritative for Hero turn. The yellow/green panel progress bar is confirmation only.
10. Action ledger combines card presence, commitments, stack, expected order and street transitions. Transient `Pago/Desisto/Aumento` text is corroboration only.
11. Commitment resolution priority: fixed ROI numeric → persisted seat-ledger commitment → street stack delta → BLOCK.
12. `toCall = max(active commitments) - Hero commitment`; button OCR/time-bank text is never a price source.
13. Fast folds may be recovered from stable card disappearance while the player still faces an unmatched bet, even if the turn-band was missed.
14. Card disappearance does not automatically mean FOLD. If the player owed nothing and a completed turn had no commitment increase, the action is CHECK; later table cleanup/showdown disappearance is ignored.
15. Snapshot Validator + `seat-state-ledger-v1` must both be complete before the Brain can run.

## Hard Brain gate

The Brain is blocked unless Hero has two valid unique cards, board count is exactly 0/3/4/5 with no decode gap, the physical Hero turn is confirmed, buttons are physical/legal, position is frozen from dealer + dealt-in seats, pot/stack/`toCall` are finite and consistent, `toCall` comes from seat state, and the action ledger is complete with zero unresolved actions.

A bad read should become an abstention/BLOCK. It must never be converted into a plausible-looking recommendation.

## Important locked regressions

- `50,69` must never become `0,69`.
- `40,78` must never become `0,78`.
- Session 3 opponent commitment `1,20` must never become `0,20` because the `US$` prefix was clipped.
- Session 3 decision 11 must resolve `toCall=1.10`.
- Board count 5 with only 4 decoded cards is BLOCKED.
- Hero time bank/button text cannot become `toCall`.
- A visible stack/panel does not imply dealt-in.
- A fold cannot change Hero position mid-hand.
- `CHECK` is invalid if the player still owes chips relative to table max.
- End-of-hand card cleanup after a valid CHECK must not be rewritten as FOLD.
- A fast fold may be recognized from card disappearance while facing a bet even if the turn indicator was too brief to sample.
- Hand 22 in session 1 remains continuous across the historical 868.5 s visual gap.
- Session 2 hands 6 and 12 have dealer `LT` and Hero `HJ`; these lock the strict dealer-button detector.
- Session 3 hand 3 (`Ah 8d`) is a BB walk with five opponent folds and no physical Hero decision.

## Release battery

```bash
python3 tests/offline_video_regression.py "/path/to/2026-09-20 22-25-57.mkv"
python3 tests/offline_video_generalization.py "/path/to/2026-09-20 22-25-57.mkv" "/path/to/2026-09-21 11-49-44.mkv"
python3 tests/offline_video3_regression.py "/path/to/2026-09-20 22-25-57.mkv" "/path/to/2026-09-21 11-49-44.mkv" "/path/to/2026-09-21 13-32-02.mkv"
npm test
```

`offline_video_regression.py` protects the baseline session. `offline_video_generalization.py` protects the independent second-session behavior. `offline_video3_regression.py` reproduces the third-session source-video gate without local caches. `npm test` locks all compact ground-truth, continuity, runtime and safety regressions in CI.

Frozen aggregate report: `standalone-lab/calibration/offline-three-session-gate-report-v1.json`.

Current audited source-video scope: **56 hands and 118 physical Hero decisions** across three sessions. Passing these recordings is evidence of materially better generalization and continuity, not a claim of universal perfection. No new runtime/release should be produced until all four commands are green.

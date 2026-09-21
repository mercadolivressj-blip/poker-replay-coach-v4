# SSJ Poker AUTO — offline video gate

This branch treats the PokerStars 1280x720 capture as a fixed-layout engineering dataset before any live recommendation is allowed.

## Source dataset

- Recording: `2026-09-20 22-25-57.mkv`
- 1280x720, 30 FPS, 1027.633 s
- Offline sample grid: one frame every 5 seconds (206 frames)
- Golden states are hand-labeled from the recording, not inferred from hand history.

## Reader order

1. Fixed Hero card slots (2 independent slots)
2. Fixed board card slots (5 independent slots; face-up presence per slot)
3. Dedicated numeric ROIs for pot, Hero stack and seat commitments
4. PokerStars-theme numeric template bank for `0-9`, decimal comma/dot normalization
5. Dealer button detector constrained to the known table geometry
6. Per-seat state: occupied, cardsPresent, stack, commitment, previousCommitment, turn
7. Action reconstruction from state deltas; transient action text is confirmation only
8. Position from dealer + occupied seats only
9. Snapshot Validator
10. Brain only after the validator returns `ok:true`

## Hard Brain gate

The Brain is blocked when Hero does not have two decoded cards, board count is not 0/3/4/5, any visible board slot has a decode gap, current Hero buttons are unavailable, position is unavailable, `toCall` exceeds Hero stack, or the action history is not complete.

## Golden video regressions

- 240 s: board face-up slots 1-3 only; pot 2.60; Hero stack 50.69; dealer nearest RT.
- 300 s: no board; pot 1.75; Hero stack 49.54; commitments LB 0.25 and TOP 0.50; dealer nearest Hero.
- 420 s: Hero `2s 2c`; board `As 7d 9s 4d Ah`; pot 2.14; Hero stack 56.85; dealer TOP. This is the regression for the historical `board count=5 / decode=4` failure.
- 600 s: Hero `Kc Qh`; empty board; pot 0.75; Hero stack 54.35; commitments Hero 0.25 and LB 0.50; dealer RB.
- 780 s: showdown frame; pot 33.49; Hero stack 42.43; dealer LT.

The older calibration entry for 780 s (`3.55 / 39.28`) was incorrect and was corrected by direct inspection of the uploaded recording.

## Running the offline battery

```bash
python3 tests/offline_video_regression.py "/path/to/2026-09-20 22-25-57.mkv"
node tests/snapshot-validator-v1.test.mjs
node tests/seat-delta-inference-v1.test.mjs
```

No live runtime release should be produced from this work until these tests pass against the source recording.

# SSJ Poker AUTO — offline video gate

This branch treats the PokerStars 1280x720 capture as a fixed-layout engineering dataset. The scope remains replay/simulation/post-session analysis; the gate is intentionally conservative and never trades missing evidence for a recommendation.

## Source dataset

- Recording: `2026-09-20 22-25-57.mkv`
- 1280x720, 30 FPS, 1027.633 s
- Offline sample grid: one frame every 5 seconds (206 frames)
- Session ground truth: `standalone-lab/calibration/session-2026-09-20-ground-truth-v1.json`
- 23 confirmed hands
- 45 confirmed Hero physical decision-button anchors
- Golden states are hand-labeled from the recording, not inferred from Hand History.

A previous coarse segmentation produced 24 starts. The `868.5 s` split is explicitly rejected: the `7s 7c` hand beginning around `859 s` continues through the visual gap and reaches another Hero decision around `884 s`.

## Reader order

1. Fixed Hero card slots (2 independent slots)
2. Fixed board card slots (5 independent slots; face-up presence per slot)
3. Rank+suit template matcher with absolute-score + distinct-label margin; ambiguous cards abstain
4. Dedicated numeric ROIs for pot, Hero stack and seat commitments
5. PokerStars-theme digit template bank for `0-9`; values are segmented into glyphs before classification and the last two glyphs are cents
6. Dealer button detector constrained to the known table geometry
7. Dealt-in seat detector from card backs/faces, not merely visible player panels/stacks
8. Per-seat state: cardsPresent, stack, commitment, previousCommitment, turn, folded
9. Action reconstruction from state deltas; transient action text is confirmation only
10. `toCall = max(active commitments) - Hero commitment`; button OCR/time-bank text is never an input
11. Position from dealer + dealt-in seats only
12. Physical Hero action-button detector; pre-action checkboxes are negative examples
13. Snapshot Validator
14. Brain/strategy runner only after the validator returns `ok:true`

## Hard Brain gate

A snapshot is blocked unless all of the following are true:

- Hero has exactly two valid, unique cards and `heroPresence === present`;
- board has exactly 0/3/4/5 valid cards with no decode gap or duplicate/overlapping card;
- Hero turn is physically confirmed by the action-button band;
- Hero buttons came from `physical-action-buttons`, not pre-action checkboxes or OCR text;
- position exists and its provenance is `dealer-plus-occupied-seats-only` (occupied here means dealt-in for the hand);
- pot, Hero stack and `toCall` are finite and internally consistent;
- `toCallSource === commitment-delta`;
- reconstructed action history is complete up to Hero;
- the eventual recommended action is one of the currently physical/legal Hero buttons.

## Golden video regressions

- 240 s: board face-up slots 1-3 only; pot 2.60; Hero stack 50.69; dealer nearest RT.
- 300 s: no board; pot 1.75; Hero stack 49.54; commitments LB 0.25 and TOP 0.50; dealer nearest Hero.
- 420 s: Hero `2s 2c`; board `As 7d 9s 4d Ah`; pot 2.14; Hero stack 56.85; dealer TOP. This is the regression for the historical `board count=5 / decode=4` failure.
- 600 s: Hero `Kc Qh`; empty board; pot 0.75; Hero stack 54.35; commitments Hero 0.25 and LB 0.50; dealer RB.
- 780 s: showdown frame; pot 33.49; Hero stack 42.43; dealer LT.
- 859–884 s: same `7s 7c` hand across a transient Hero visual gap; no false hand transition at 868.5 s.

The older calibration entry for 780 s (`3.55 / 39.28`) was incorrect and was corrected by direct inspection of the uploaded recording.

## Numeric safety changes

The numeric reader no longer tries a shorter integer hypothesis when a leading glyph is difficult. It segments the actual digit glyphs first and requires 1–3 integer digits plus exactly two decimals. Ambiguous/malformed strings return `None` rather than silently converting `50,69` into `0,69`.

`connectedComponentsWithStats` was also removed from the long-running fixed-layout readers after native OpenCV crashes were observed during dataset work. Tiny PokerStars glyph/button/dealer components now use contour-based extraction.

## Running the offline battery

```bash
python3 tests/offline_video_regression.py "/path/to/2026-09-20 22-25-57.mkv"
node tests/snapshot-validator-v1.test.mjs
node tests/seat-delta-inference-v1.test.mjs
node tests/hand-transition-v1.test.mjs
node tests/validated-study-runtime-v1.test.mjs
```

The video regression checks the 23-hand ground truth, all 45 Hero decision anchors, card abstention, numeric leading digits, dealer anchors, commitments, action-delta rules and the known false hand split.

No new runtime/release should be produced from this work until the source-video battery and the normal CI suite are both green.

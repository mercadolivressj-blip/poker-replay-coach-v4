# START HERE IN THE NEXT CHAT

Continue the **SSJ Poker AUTO / Poker Replay Coach V4** project.

## Repository and branch

- Repository: `mercadolivressj-blip/poker-replay-coach-v4`
- Mandatory branch: `vision-v1-brain-integration`
- **Never touch `main`.**
- Resolution/live-telemetry fix: commit `be87b71` (parent of this documentation update on GitHub).
- Primary runtime: `standalone-lab/ssj-poker-auto-v34-unified.html`.

Before changing code, read:

1. `docs/LIVE-TEST-2026-09-22.md`
2. `docs/MASTER_CONTEXT.md`
3. `README.md`

## Current verified state

- Frozen offline certification: **108/108 hands and 246/246 decisions** across six recordings.
- First genuine 1920×1080 screen-capture telemetry: 7 hands, 12 recorded Hero turns (11 real + 1 false reopen), 15 emitted actions, 0 decisions because the conservative gate correctly blocked incomplete state.
- Root cause: `commitmentPixelCanvas` used raw 1280×720 source coordinates while the live MediaStream was 1920×1080. Cards, board, pot and stack already used resolution-normalized crops.
- Fix: commitment crops now scale through `captureNative`; nearest-neighbor reduction preserves deterministic numeric glyphs.
- Fix: a brief visual dropout resumes the same Hero epoch only when hand, street, cards, board, legal buttons, Hero commitment and action count are unchanged.
- Direct 1920×1080 frame validation: **9/9 commitment values correct**, including `0.02`, `0.05`, `0.04`, `0.03` and `0.06`.
- Full public suite passed after `npm run prepare`: 91 modules plus all ground-truth, ledger, `toCall`, position, snapshot and V34 tests.
- Browser automation could not run because this execution environment had no Chromium and its download endpoint returned an empty archive. Do not describe the live fix as 99% certified until a new real replay/simulation telemetry export passes.

## Next action

Build/download the new standalone package and repeat the same recorded-table replay or simulation at 1920×1080. Acceptance criteria:

1. no `commitment_ambiguity` caused by resolution;
2. calls, bets and raises carry the visible amounts;
3. no false folds from zero-commitment inference;
4. the dimming interval resumes the same turn instead of creating a duplicate;
5. recommendations are produced only after the complete-state gate passes;
6. report decision latency P50/P95.

## Hard rules

- Replay/simulation/post-game study only; no live real-money RTA, click automation, hidden overlay, process/memory hooks or anti-cheat bypass.
- Do not commit private PokerStars recordings, screenshots, telemetry or credentials.
- Preserve the conservative gate: missing evidence must block a recommendation.
- Every real bug needs a regression test.
- Prefer surgical changes; do not redesign the validated scanner without evidence.

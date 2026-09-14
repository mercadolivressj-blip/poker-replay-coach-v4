# Poker Replay Coach — Session Archive — 2026-09-12

## Purpose
This file is the durable handoff/continuity ledger for the R14 Poker Replay Coach work from the long debugging session on 2026-09-12. It exists so a future chat/session can continue without relying on chat memory alone.

## Safety / product scope
- Replay / simulation / post-game study only.
- No live hooks, no click automation, no hidden opponent cards, no anti-cheat behavior, no real-money live RTA.
- Hero hole cards are manual-only in R14. Public table state is read by vision.

## Repository / branch / PR
- Repo: `mercadolivressj-blip/poker-replay-coach-v4`
- Working branch: `feature/state-transaction-r14`
- Draft PR: #9 — `R14: make replay state transactional and remove competing resets`
- PR base: `feature/pokerstars-suit-scanner-r9`
- Head at archive time: `0ced184a7dc5cb1d450149e32801e8ea6fee3460`
- GitHub Actions run #819 completed SUCCESS at archive time.

## Production/deployment history relevant to this session
- Main production domain used during testing: `https://poker-replay-coach-v4.vercel.app/r14.html`
- Earlier broken UI-loop production commit: `ede455f75f5ebe2b5533be5742f5ebe18bd2691f`
- UI feedback-loop fix: `7798a1222ae229763588233491424f5f674fca15`
- Later production commit that included lifecycle/state fixes and was used for the first end-to-end retest: `f74e4c2ae8e39d5d80860659d22f5c4f370286c6`
- Frontend hang fix later published around commit `76bc171` (renderer isolation / observer removal).
- IMPORTANT: before any future deploy, verify PR head and CI; do not assume the currently aliased Vercel production points at the newest GitHub head.

## Uploaded source videos (exact original files)
These two original OBS recordings were present in the working container and are the canonical visual evidence for this session:
1. `2026-09-12 10-36-06.mkv` — 260,280,036 bytes — ~13-minute first long diagnostic recording.
2. `2026-09-12 14-03-29.mkv` — 85,861,440 bytes — ~5-minute retest recording that exposed the forced-fold deadline bug and other issues.

Keep the exact originals. They are more valuable than screenshots because the failures are temporal/state-transition bugs.

## User goal / UX contract
The user does not know poker yet and wants the Coach to teach correctly from replay. Therefore:
- The Coach must never publish a strategic action merely because a timer expired.
- A decision can only be strategic after the Coach knows the user's two manual hole cards AND has a trustworthy current public decision context.
- Required public context includes, when relevant: current hand generation, street/board, pot, Hero turn/actions, position, current commitments, whether the pot is unopened/limped/raised, actual aggressor (not blind poster), and call/raise sizing.
- If the state is incomplete or contradictory, the correct product behavior is `ANALISANDO` or `LEITURA INSUFICIENTE`, never a fabricated FOLD/CHECK/CALL/RAISE.
- The visible explanation must teach *why* the action is preferred: position, prior action, sizing, pot odds/equity, range/context, alternatives.

## Major failures seen in the first ~13-minute recording
1. Old board/street leaking into the next physical hand.
   - Severe example around ~09:40–09:50: old board `9♠ T♣ 3♣` survived while the table had already cleared and then opened `7♦ 2♥ 6♠`.
   - This could cause a recommendation on the wrong street/board.
2. Manual Hero cards disappearing mid-hand because lifecycle/generation could reset incorrectly.
3. Pot divergence / stale pot, e.g. real center pot larger than Coach state.
4. Pot sometimes regressed within the same hand due delayed/stale reads.
5. Mandatory SB/BB was sometimes treated as aggression; BB was labeled aggressor in unopened preflop spots.
6. Strategic recommendation sometimes appeared while fast decision consensus was only `1/2`.
7. Old local renderer and new decision-store renderer both wrote the visible recommendation box, creating two competing strategic/UI brains.
8. That UI competition later caused Chrome `RESULT_CODE_HUNG` (frontend hang).
9. Made-hand explanation could still mention weaker draw labels (e.g. made straight plus “open-ended draw”), which is didactically confusing.

## Architecture/fixes built from the first recording
### Transactional hand state / lifecycle
- `DealSnapshotArbiter` owns Hero/board/pot per generation.
- New `DealLifecycleR14` uses sustained physical Hero-card disappearance + reappearance as the authoritative new-deal boundary; card ranks are deliberately ignored because Hero cards are manual-only.
- Generation rotation must atomically blank Hero, board, pot, street, actions, decision state.
- Board-clear is an additional public transition signal, not sole owner of generation.
- Delayed packets from old generation must be rejected.

### Manual Hero
- Hero hole cards are manual-only.
- AI endpoints always return `hero=[]`, `heroConfidence=0`.
- Legacy automatic Hero authority is not booted in R14.
- Manual Hero should remain locked through one physical hand and clear only on a real hand boundary.
- A later `manual-hero-boundary-r14.js` layer was added so a user entering the next hand's cards after a trusted physical/public transition can confirm/rebase the hand boundary instead of binding new cards to an old generation.

### Board trust
- Normal strategy requires trustworthy current board.
- Board trust can be satisfied by stable physical board occupancy OR exact fast-lane board identity confirmed 2/2 when the local count-only detector lags.
- During hand transition, strategy is blocked.

### Pot
- Within the same hand, a stale read cannot move pot backwards.
- Manual correction is allowed to decrease/rebind pot intentionally.
- Fast decision lane owns exact current-turn pot once it has current decision evidence; full-frame should not overwrite it during Hero decision.
- Vision prompts were strengthened to read only the literal text after `Pote:` and NOT confuse the chip-stack/wager number drawn beneath the board with the pot. Concrete examples from the 5-minute replay: if `Pote: US$ 0,50` and a separate chip label below shows `US$ 0,31`, pot must be 0.50; if `Pote: US$ 0,92` and separate label shows `US$ 0,67`, pot must be 0.92.

### Preflop context
- New `preflop-context-r14.js` classifies `unopened`, `limped`, `raised`.
- Forced blinds are not aggression.
- A real raise requires explicit bet/raise/all-in evidence or commitment clearly above the BB threshold.
- New deterministic position-based unopened preflop policy exists; it is an educational deterministic chart, not DeepStack/GTO.
- Examples used in debugging:
  - A6o SB, only .01/.02 blinds, pot .03: should not be folded because BB is not aggressor; deterministic policy prefers raise.
  - ATo HJ unopened: policy opens/raises.
  - 97s HJ unopened: deterministic chart folds.
  - QTs BTN facing real early-position 3x open: fold was considered defensible.

### Decision safety
- Normal strategic actions require manual Hero + fresh current context + raw fast decision 2/2 + consensus 2/2 + board trust + current actions.
- Postflop strategy must not publish at 1/2.
- The old “7-second conservative fallback = FOLD” was proven wrong and removed.
- Decision clock now starts only AFTER the two manual Hero cards are locked.
- On deadline without trustworthy snapshot: `LEITURA INSUFICIENTE`, never a strategic action.
- If a trustworthy 2/2 reading arrives while it is still Hero's turn, it may replace the insufficient-reading warning.

### UI single source / Chrome hang
- Old `main.js` strategy renderer and new decision-store renderer fought over the same DOM.
- This caused visible flicker/competing decisions and eventually Chrome `RESULT_CODE_HUNG`.
- Fix: isolate legacy renderer to disposable targets and make the new decision-store UI the only owner of the real recommendation box; remove the unnecessary observer feedback loop; add explicit UI hang regression.

## Second ~5-minute recording — critical findings
The retest showed repeated `DESISTIR` immediately/soon after manual card selection. The important discovery:
- Those folds were NOT strategic solver conclusions.
- They came from the 7-second decision watchdog fallback: “Prazo de decisão atingido sem snapshot completo; linha conservadora: DESISTIR”.
- Because the clock could start while the manual card picker was still open, the user could enter any hand and immediately receive FOLD.
- This is unacceptable for a teaching tool because missing data was being converted into poker strategy.

Corrections made after this recording:
1. Removed strategic deadline fallback. Missing state -> `LEITURA INSUFICIENTE`.
2. Decision timer starts only after manual Hero is confirmed.
3. Tightened the strategic gate to require fresh public table context (`fresh-table-context`) in addition to manual Hero, fast 2/2, and board trust.
4. Added/expanded manual Hero boundary logic for hand transition/rebinding.
5. Strengthened pot prompt disambiguation in both decision-state and full-state APIs.
6. Updated tests for manual-Hero boundary, deadline behavior, pot prompt, and fresh context.

## Important exact behavioral rule to preserve
**Never teach a poker action unless all decision-critical evidence is current and belongs to the same physical hand.**
If any of the following is uncertain/stale — Hero manual cards, generation, board/street, pot, current actions, preflop action context/position — return a non-strategic state and keep reading.

## Tests/regressions that must stay in the suite
- `tests/video-regressions-r14.mjs`
- `tests/video-shadow-replay-r14.mjs`
- `tests/ui-hang-regression-r14.mjs`
- `tests/manual-hero-only-r14.mjs`
- `tests/manual-hero-boundary-r14.mjs`
- `tests/decision-finalizer-r14.mjs`
- `tests/preflop-context-r14.mjs`
- `tests/ai-decision-r14.mjs`
- `tests/ai-full-state-r14.mjs`
- runtime-contract test
- browser smoke

At archive time, PR head `0ced184a7dc5cb1d450149e32801e8ea6fee3460` had GitHub Actions run #819 SUCCESS.

## Remaining work / next-session priorities
1. Do NOT rush to deploy merely because unit CI is green. Verify production commit/bridge pin and endpoints explicitly.
2. Re-run end-to-end replay/simulation with the newest head after deployment.
3. Review the new recording frame-by-frame and separate:
   - perception/state error;
   - lifecycle/generation error;
   - strategy error;
   - explanation/didactic error.
4. Confirm the 5-minute replay's forced folds cannot recur after the deadline change.
5. Confirm manual Hero no longer binds to a stale hand generation when new physical cards are entered.
6. Confirm pot labels from the center `Pote:` text are used, not the separate below-board chip amount.
7. Confirm fresh table context/position is present before preflop strategy is published.
8. Confirm board/street/pot from prior hand never leak into the next hand.
9. Confirm postflop strategic action is never shown at 1/2.
10. Improve didactic explanation so made hands do not display misleading lower-order draw labels.
11. Eventually deepen strategy toward resolver/DeepStack-like quality, but only after perception/state correctness is trustworthy.

## Communication / user expectations
- User prefers Portuguese, casual and direct.
- User wants implementation and testing, not repeated theory/questions.
- Do not claim “perfect” or “100%” without end-to-end evidence.
- The user explicitly asked not to lose the learnings or videos from this session.

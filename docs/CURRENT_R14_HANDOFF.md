# Poker Replay Coach V4 — CURRENT R14 HANDOFF

> Source of truth for the next chat. Created when the current ChatGPT conversation hit its duration limit on 2026-09-11.
> Read this file **before changing code**. It supersedes the stale “current state” section in `docs/MASTER_CONTEXT.md`.

## 1. Scope / hard constraints

This project is **replay / simulation / post-game study only**. Do not adapt it for live real-money RTA. Never add process/memory hooks, click/input automation, hidden overlays, anti-cheat bypasses, or opponent-hole-card reading.

The user wants a professional study coach with a fast local perception path, reliable state, and eventually a DeepStack-like continual resolver direction. GPT can be coach/auditor/teacher, not the critical decision clock.

Repository: `mercadolivressj-blip/poker-replay-coach-v4`

## 2. Current branch / PR / preview

- Active branch: `feature/state-transaction-r14`
- R14 code head before this handoff documentation commit: `6299c79dbf82e24b0c450ed08a4cb37109cd5794`
- Draft PR: #9 — `R14: make replay state transactional and remove competing resets`
- PR base: `feature/pokerstars-suit-scanner-r9`
- R14 CI run: `34656643414`
- CI result: **success** (`npm test`, runtime-contract, browser-smoke all green)
- R14 preview base URL: `https://poker-replay-coach-v4-3kfzmy7mg-mercadolivressj-blips-projects.vercel.app`
- Share links are temporary and should be regenerated in a new chat.

## 3. Important stable history

Known historically stable recovery point:

`d153f5ae0f73ae361facfb281cdd723ffa54f4c8`

That build was fluid and had good board/pot reading, with the main perception weakness being Hero suit completion. Do not reintroduce heavy OCR loops that previously froze Chrome/PC.

Key later stages:

- R9: dedicated PokerStars suit scanner (`♣ ♦ ♥ ♠`) based on real replay glyph templates; board became very strong in real tests.
- R11: Hero Authority path restored the older proven fixed-slot Hero reader and layered the R9 suit scanner on top.
- R12: fixed a concrete bug where `handId` changes cleared the Hero latch.
- R13: added decimal-money support such as `US$ 0,07`; fixed the old `<= 1` pot rejection and cent rounding.
- R14: removed competing quarantine/lifecycle writers and introduced transactional state restoration.

## 4. R14 bootstrap / architecture

R14 bootstrap is intentionally smaller:

```text
runtime-guards
main
money-runtime-r13
state-transaction-runtime-r14
board-refiner-runtime-r14
suit-scanner-runtime-r9
hero-authority-runtime-r11
resolver-runtime
```

Important: R14 intentionally removed `replay-lifecycle-r8` and the old full `card-refiner-runtime` from the active bootstrap because both had independent quarantine / new-hand behavior that could blank Hero/board.

Hero Authority is intended to be the visual redeal authority. Board fallback should read board only and not touch Hero lifecycle.

## 5. What R14 fixed conceptually

Before R14 several modules could independently write/reset the same state:

- lifecycle quarantine could set Hero/board empty and UI to `—`;
- card refiner had another visual quarantine/newHand path;
- pot-drop lifecycle could rotate the hand after a bad decimal OCR sample;
- Hero Authority had its own latch.

This caused severe blinking: correct cards appeared, then disappeared, then came back.

R14 introduced a transactional snapshot concept: confirmed Hero/board/pot should be restored through bad frames instead of transiently rendering `—`.

## 6. Most recent real R14 test — CRITICAL

R14 reduced some blinking but **introduced/left sticky stale-state and same-hand rank-mutation problems**. These observations are the highest-priority next work.

### A. Stale board / pot survived into a state where no current board existed

In the latest replay, the physical table showed no board, but the Coach still showed a previous river board approximately:

`A♥ 6♥ 5♥ 4♥ 3♠`

with street `river` and stale/incorrect pot values (`0,09`, later even `8`).

This means the transactional snapshot can be **too sticky across real hand transitions**.

### B. Board could stay stale even after a new physical board appeared

A later frame physically showed a new board around:

`2♥ 3♠ T♠`

while the Coach still displayed the old prior-hand board. Therefore the next fix must distinguish:

- temporary bad frame => keep snapshot;
- **real redeal / new board generation => replace snapshot atomically**.

### C. Hero first rank mutated inside the same physical hand

The user’s actual Hero hand was visibly `7♠ 3♣`.

During the same hand, the Coach first “cravou”/recognized the `7`, but then changed that first rank to `3` and later to `2`.

This is unacceptable. **Once a physical hand is confirmed, a slot rank must not mutate within that same deal.** A new contradictory rank is evidence/noise, not permission to overwrite the confirmed card.

This is the most important latest user observation.

### D. Board generally improved a lot before R14

Across R9–R13, the board was repeatedly described by the user as reading “PERFEITO” or very well, especially ranks/suits after the dedicated suit scanner. Therefore do not redesign the board classifier unless needed. The current R14 board problem is primarily **state generation / stale snapshot replacement**, not necessarily recognition quality.

### E. Pot decimal parsing is partly fixed but state can still be stale/wrong

R13 correctly enabled decimal values such as `US$ 0,07`, `US$ 0,05`, `US$ 0,38`.

However latest R14 screenshots still showed impossible/stale UI values such as `4` or `8` while the physical pot label was around `US$ 0,07` / `US$ 0,13`.

Therefore do not assume money parsing alone is broken. The likely issue is **state ownership / snapshot replacement / bad OCR sample acceptance**.

## 7. The TWO latest user directives / ideas — preserve these

### Directive 1 — confirmed card must be immutable during the same deal

The user explicitly reported: the system recognized the `7`, then changed it to `3`, then `2`.

Next implementation should enforce a **per-slot commit lock**:

- once Hero slot 0 is committed as `7♠` for deal generation N, subsequent contradictory reads are ignored;
- same for slot 1 and for confirmed board slots;
- cards may change only when a **new physical deal generation** is confirmed;
- new hand detection must not depend on the rank that is itself noisy.

### Directive 2 — add a manual `Refresh / Recalibrar leitura` button

User idea: add a button to manually force a clean perception refresh.

Desired semantics:

- clearly labeled, e.g. `Recalibrar leitura` or `Refresh leitura`;
- replay-study only;
- should clear **sensor candidates / geometry caches / pending consensus**, then immediately recapture the current visible frame;
- should **not** blindly advance the hand or invent a new hand;
- ideally provide two modes internally:
  - soft refresh: re-read current deal while preserving the deal generation;
  - if current state is obviously stale, allow controlled rebind of Hero/board/pot from the visible physical frame;
- must not bring back old multi-writer blinking.

This button is a user-requested UX safety valve, not a substitute for fixing lifecycle correctness.

## 8. Recommended next architecture — do this before more threshold tuning

Do **not** add more independent readers that write directly to `machine.state`.

Use a single authoritative deal snapshot, conceptually:

```js
DealSnapshot = {
  generation,
  hero: [slot0, slot1],
  board: [slot0..slot4],
  pot,
  street,
  committedAt,
}
```

Sensors only emit observations. One arbiter owns commits.

Rules:

1. A confirmed Hero rank/suit cannot mutate during the same generation.
2. A confirmed board slot cannot mutate during the same generation.
3. Bad/missing frame = no new evidence, never erase.
4. New generation requires **physical redeal evidence**, not textual rank disagreement alone.
5. On new generation, replace Hero/board/pot/street **atomically**, not one field at a time.
6. The `Refresh / Recalibrar leitura` button asks the same arbiter for a clean re-observation; it must not bypass the arbiter.
7. Pot OCR outliers need temporal sanity checks; a one-frame `4` must not replace `0,07` or trigger lifecycle.

## 9. Suggested immediate implementation sequence for next chat

1. Read this file, `docs/MASTER_CONTEXT.md`, `README.md`, PR #9 and R14 source.
2. Inspect exactly who can currently write `machine.state.hero`, `board`, `pot`, `handId` in R14.
3. Build a small **single state arbiter / deal generation lock** rather than another reader.
4. Add regression for same-deal Hero rank mutation: committed `7♠ 3♣` cannot become `3? 3♣` or `2? 3♣`.
5. Add regression for stale board across real redeal: old river board must be atomically replaced/cleared only when new physical generation is confirmed.
6. Add regression for decimal pot outlier: `0.07 -> 4 -> 0.07` does not change committed pot/lifecycle.
7. Add `Recalibrar leitura` button wired to the arbiter, not directly to state.
8. CI.
9. Preview.
10. Test multiple consecutive replay hands.

## 10. Performance / stability constraints

The user is tired of repeated manual testing and browser instability. Do not ask for many blind stress tests.

Do not reintroduce:

- second aggressive Tesseract loops every ~100ms;
- multiple new background OCR modules at once;
- browser-heavy full-screen template search when fixed table geometry works;
- direct multi-writer state mutation.

Keep the app fast; prior continual resolver measurements were roughly ~75–117 ms background prepare and ~0.24–0.45 ms final decision.

## 11. Opponent action reading status

Do not claim robust opponent-action reconstruction yet. Earlier table observer endpoints had 500/501/404 deployment/config problems and action history from PokerStars replay has **not** been empirically proven robust.

Opponent exact cards are never read.

If no reliable timeline exists, resolver confidence should fall rather than inventing action history.

## 12. Current user sentiment / workflow

The user has spent essentially the whole day testing this perception issue and is exhausted by iterative regressions. Next chat should avoid repeating old experiments. Treat this checkpoint as binding history and make the next change architectural + regression-driven.

User style: Brazilian Portuguese, direct, friendly. They want concrete progress, preview links without login, and do not want to re-explain the entire project.

## 13. Exact next-chat instruction

Start the next chat with:

> Continue o Poker Replay Coach V4 a partir do R14. Leia primeiro `docs/CURRENT_R14_HANDOFF.md`, depois `docs/MASTER_CONTEXT.md`, `README.md` e o PR #9. NÃO repita os testes antigos. O bug atual é: estado confirmado fica stale entre mãos e um rank confirmado do Hero pode mudar dentro da mesma mão (7 -> 3 -> 2). Quero implementar um único arbiter de DealSnapshot, travar cartas por generation e adicionar o botão `Recalibrar leitura` que eu sugeri. Preserve o board/suit scanner que já ficou bom e o parser decimal R13.

That is the canonical continuation point.
# START HERE IN THE NEXT CHAT

Continue the **Poker Replay Coach V4** project from the current R14 checkpoint.

Before doing anything:

1. Read `docs/CURRENT_R14_HANDOFF.md` completely. **This is the newest source of truth.**
2. Then read `docs/MASTER_CONTEXT.md` and `README.md`.
3. Inspect draft PR #9 (`R14: make replay state transactional and remove competing resets`).
4. Check the current head of `feature/state-transaction-r14` and latest CI.

Current highest-priority real replay bugs:

- R14 can keep stale board/pot across a real hand transition.
- A confirmed Hero rank can still mutate inside the same physical hand; latest observed example: the first card was correctly recognized as `7`, then changed to `3`, then to `2`.
- This must be fixed at the state-ownership / generation level, not by adding more threshold tuning.

Two latest user directives that MUST be preserved:

1. **Confirmed cards must be immutable within the same physical deal generation.** Contradictory later reads are noise, not permission to overwrite.
2. Add a manual **`Refresh / Recalibrar leitura`** button that asks the single state arbiter to recapture/rebind the visible replay state cleanly, without bypassing lifecycle safety.

Recommended next move:

- implement one authoritative `DealSnapshot` / state arbiter;
- sensors emit observations only;
- Hero/board/pot/street commit atomically by generation;
- bad frame never erases confirmed state;
- real redeal replaces the generation atomically;
- add regressions for `7 -> 3 -> 2`, stale river board into new hand, and decimal pot outlier `0.07 -> 4 -> 0.07`;
- wire the new `Recalibrar leitura` button to the arbiter.

Hard rules:

- Replay/simulation/post-game study only.
- No live real-money RTA, process/memory hooks, click/input automation, hidden overlays, opponent-hole-card reading, or anti-cheat bypass.
- Do not go back to Lovable.
- Work only in `mercadolivressj-blip/poker-replay-coach-v4`.
- Do not touch unrelated SSJ/VIEK projects.
- Never commit private PokerStars screenshots or secrets.
- Preserve the fast local path and the R9 suit scanner / R13 decimal money work unless a regression proves they are wrong.
- Do not reintroduce heavy OCR loops that previously caused browser/PC freezes.
- Every real bug must become a regression test before/with the fix.

Canonical prompt to paste in the next chat:

> Continue o Poker Replay Coach V4 a partir do R14. Leia primeiro `docs/CURRENT_R14_HANDOFF.md`, depois `docs/MASTER_CONTEXT.md`, `README.md` e o PR #9. NÃO repita os testes antigos. O bug atual é: estado confirmado fica stale entre mãos e um rank confirmado do Hero pode mudar dentro da mesma mão (7 -> 3 -> 2). Quero implementar um único arbiter de DealSnapshot, travar cartas por generation e adicionar o botão `Recalibrar leitura` que eu sugeri. Preserve o board/suit scanner que já ficou bom e o parser decimal R13.

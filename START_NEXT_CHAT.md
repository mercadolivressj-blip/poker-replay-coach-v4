# START HERE IN THE NEXT CHAT

Continue the **Poker Replay Coach V4** project.

Before doing anything:

1. Read `docs/MASTER_CONTEXT.md` completely.
2. Read `README.md`.
3. Check the current `main` HEAD and the latest CI run.
4. Treat the current architecture as the baseline because the latest real-user feedback is: **the V4 is working very well / “PERFEITO agora”, with only a few improvements left**.

Hard rules:

- Do **not** go back to Lovable for V4 development.
- Work only in `mercadolivressj-blip/poker-replay-coach-v4`.
- Do not touch SSJ, VIEK, or unrelated repos/projects.
- Replay/simulation/post-game only; no live real-money RTA, process/memory hooks, click automation, hidden overlays, or anti-cheat bypass.
- Never commit or expose `OPENAI_API_KEY`, `VISION_ACCESS_TOKEN`, or private PokerStars screenshots.
- Preserve the low-latency architecture: physical action buttons determine Hero turn; AI is background teacher only.
- Every real bug should become a regression test before/with the fix.
- Prefer surgical improvements over redesigns.

Ask the user for the **one or two remaining improvements** they want, then inspect the relevant code before changing anything.

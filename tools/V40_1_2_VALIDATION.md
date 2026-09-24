# V40.1.2 Replay Hardening

Scope: **capture / action ledger only**. The embedded V40.1 strategy module block must remain byte-for-byte unchanged.

## Evidence from replay telemetry 2026-09-24

- Terminal river state with two physical buttons (`FOLD/CALL`) was missed by the older loader after villain's river shove. The V40.1.1 terminal-button detector is preserved.
- OCR commitment flicker produced `1.98 -> 1.96` on the same villain bet. A hero commitment of `1.98` was therefore at risk of being classified as a raise. V40.1.1 introduced a 0.025 minimum money tolerance; V40.1.2 applies the same tolerance consistently to stable-candidate closure and hero-turn resume comparisons.
- `street-transition-survivor` was previously inserted into the sovereign action history as a synthetic `CALL` with a synthetic exact amount. That is too strong: survival only proves continuation, not the exact amount (short all-in is a counterexample). V40.1.2 records this only as diagnostic telemetry and does **not** inject the call into strategy history.
- False CHECK after prior aggression is already guarded in V40.1.1 and is retained.

## Guardrails in SAFE_PATCHER

The patcher refuses to generate output unless:

1. The input identifies as V40.1.1 and contains `strategy-v7.1-cash6max-stackoff-terminal-fix-2026-09-23`.
2. Every expected runtime patch site exists **exactly once**.
3. The SHA-256 of the complete embedded `__SSJ_MODULE_SOURCES` block is identical before and after patching.
4. The terminal `FOLD/CALL` detector remains present.
5. The 0.025 minimum money tolerance remains present.
6. The old synthetic `street-transition-survivor` CALL insertion is absent from the output.

Output: `ABRA_ESTE_V40_1_2_REPLAY_HARDENED.html`.

No change to the strategy/policy/ranges/equity engine is intended or permitted by this patch.
# Poker Replay Coach V4 — Standalone

Replay-only poker study coach rebuilt outside Lovable. It analyzes pixels from a screen-shared or uploaded **recorded replay/simulation** and keeps the decision path local; OpenAI Vision is an optional background teacher, never a prerequisite for detecting the Hero turn.

## Architecture

- **Frame Bus up to 30 FPS** — no global “frame changed” gate.
- **Hero turn from physical action buttons** — 2/3 large PokerStars buttons open the decision immediately; Dealer chat is not required.
- **Hand lifecycle from semantic card slots** — partial strict rank reads are allowed for lifecycle (`J?` can distinguish a new hand from `A9`) but Strategy only receives a complete authoritative pair.
- **Independent board/pot/action lanes** — board occupancy is 0/3/4/5; pot OCR and button amount OCR do not wait for cards or chat.
- **Latest-wins backpressure + source epoch** — slow work is dropped and an async result from a previous hand or previous replay source cannot write into the current state.
- **Local rank classifier first** — seeded from PokerStars replay glyphs; ambiguous cases abstain instead of inventing a rank. Tesseract is fallback only.
- **GPT-5.6 Sol Vision Teacher (optional)** — confirms/fills ranks and suits in background and can teach the local template bank. It is never called to decide whether it is the Hero turn.
- **Protected Vision endpoint** — keep `OPENAI_API_KEY` server-side and set `VISION_ACCESS_TOKEN` on public deployments to prevent third parties from burning API budget.
- **Deterministic Strategy V0** — replay-study heuristic using only observed state. It is not a GTO solver and deliberately returns “Leitura insuficiente” instead of inventing missing context.

## Release-candidate validation

The private pre-release fixture suite uses real PokerStars replay screenshots but those raw images are intentionally **not committed** because they contain screen names/avatars.

Current local release gates:

- 17 JS suites passed.
- 80-hand lifecycle soak with stale-write attacks passed.
- 54 transformed full-frame cases (resize / brightness / JPEG / blur): accepted rank precision **100%**, coverage **94%+**; uncertain ranks abstain.
- Direct preflop-to-preflop transition test: transformed `J2` may become strict `J?`, but two stable partial semantic samples still open exactly one new hand while Strategy waits for the second rank.
- Real fixture sequence: 8 hands, no state inheritance across generations.
- Pot OCR correctness: **9/9** private fixtures.
- Action-layout + numeric OCR: **7/7** private fixtures and **7/7** end-to-end expected study decisions.
- Local detector benchmark in this environment: low-millisecond processing; Strategy itself is sub-millisecond once state is ready.
- Static app/import smoke passed. Full Chromium smoke is run when a Chromium host is available.

These numbers are development gates, not a guarantee for every recording theme/DPI. The runtime is designed to abstain and fall back rather than publish a confident wrong card.

## Run locally

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`. The local reader works without OpenAI.

### Tests

```bash
npm install
npm test                 # public text-only unit/safety suites
npm run test:private     # requires the private full-frame fixture corpus
npm run test:ocr         # requires a system tesseract binary
npm run test:smoke
```

## Deploy on Vercel

Set these server environment variables:

```text
OPENAI_API_KEY=...
VISION_ACCESS_TOKEN=<a long random secret>
```

Then enter the same Vision token once in **Diagnóstico → Ativar Vision Teacher**. It is kept in `sessionStorage` for the current browser tab and sent only as a request header to `/api/vision`.

The API key is never shipped to browser JavaScript. In Vercel production, the Vision endpoint refuses to run without `VISION_ACCESS_TOKEN`.

## Scope

Only recorded replays, uploaded hands, and simulations. No poker-client process/memory access, click automation, hidden overlay, or anti-cheat bypass.

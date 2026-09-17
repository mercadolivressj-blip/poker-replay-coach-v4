# HYBRID ARCHITECTURE V1 — LOVABLE EYES + EXTERNAL STRATEGY

Status: **VISION V1 FROZEN**

## Rule of ownership

- **Lovable owns vision only.** It captures/interprets the PokerStars replay and returns observed table state.
- **GitHub/Vercel owns strategy, recommendation, UI logic, tests and all future product changes.**
- No future strategy/range/policy change should require editing the Lovable vision project.

## Frozen vision source

Project: `Poker Vision Gateway`

Production endpoint:

- `POST https://poker-vision-gateway.lovable.app/api/vision/read`
- `GET  https://poker-vision-gateway.lovable.app/api/vision/health`

The gateway reuses the validated Hero Card Rescue reader and its server-side Lovable AI Gateway path. Treat crops, prompts, card locks, confirmed-state rules, per-lane reading behavior and model routing as frozen unless a dedicated vision regression requires an explicit V2.

## Network topology

```text
Browser replay capture
        |
        v
Our Vercel app
        |
        | server-to-server POST
        v
Lovable Vision Gateway (eyes only)
        |
        v
VisionState v1
        |
        v
External Strategy Engine (GitHub/Vercel)
        |
        v
Recommendation/UI
```

The browser must not call Gemini directly. The external app also must not reimplement the frozen vision prompts/crops while Vision V1 remains valid.

## VisionState v1 contract

The canonical observed-state contract is:

```json
{
  "version": "vision-state-v1",
  "heroCards": ["Qh", "Jd"],
  "heroPresence": "present",
  "board": ["3s", "3c", "Ac", "Qc", "Qs"],
  "boardPresence": "present",
  "pot": "0.16",
  "heroStack": "0.72",
  "blinds": "0.01/0.02",
  "legalActions": ["CHECK", "BET"],
  "toCall": null,
  "confidence": 0.98,
  "readerModel": "flash-lite",
  "source": "lovable-vision-v1",
  "observedAt": 0
}
```

Fields may be null/empty when that lane is inconclusive. A failed/inconclusive read must never silently invent cards or actions.

## Change policy

1. Strategy changes happen in this repository.
2. Vision changes require a new explicit contract/version (`vision-state-v2`, etc.).
3. `VisionState v1` must stay backward-compatible while V1 is active.
4. Strategy must consume only the contract, never crop coordinates or raw Gemini/Lovable responses.
5. Tests must be added for any strategy change before promotion.

## Immediate migration plan

1. Proxy all vision reads through our Vercel backend to the frozen Lovable gateway.
2. Normalize every response into `VisionState v1`.
3. Migrate the frozen Hero Card Rescue strategy engine into this repository.
4. Connect `VisionState v1 -> StrategyInput -> Recommendation`.
5. Keep the original Lovable vision project untouched as the visual baseline.

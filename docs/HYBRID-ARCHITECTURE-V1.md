# Hybrid Architecture V1

## Ownership boundary

- **Lovable Vision V1 = eyes only.** It may read replay pixels and return perception.
- **GitHub/Vercel Brain = all poker decisions.** Strategy, ranges, math, MTT, ICM, exploit, history and product UI live here.
- No development prompts are sent to Lovable. Lovable AI usage is only the normal frozen vision runtime.

## Flow

`PokerStars replay -> Vision V1 -> VisionState v1 -> Brain V1 -> study recommendation`

## VisionState v1

Perception fields consumed by the Brain: heroCards, board, pot, toCall, legalActions, players, activePlayers, heroPosition, heroStack, effectiveStack, blinds, seats, actionHistory, confidence, readerModel, capturedAt.

## Hard guards

1. Legal action mask is sovereign: Brain never emits a button absent from `legalActions`.
2. Missing critical context yields `decision=null`; no guessed position, stack or action history.
3. A transient visual error never rewrites strategy state by itself.
4. New-hand clearing is owned outside Lovable (`Hand Transition V1`).
5. MTT/ICM logic must declare `APROXIMAÇÃO` until a specific range/model is independently audited.
6. This product is for post-game replay study, not live-table automation.

## Versions

- Vision: `vision-v1` frozen.
- Brain: `brain-v1` external.
- Hand transition: `hand-transition-v1` external.
- Cash preflop base: 6-max ~100bb versioned tables.
- MTT short-stack: V1 approximation pending chart/ICM validation.
- Postflop Brain V1: deterministic rules pending full Policy V4 parity port.

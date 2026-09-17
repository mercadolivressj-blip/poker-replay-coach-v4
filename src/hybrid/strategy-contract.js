export const STRATEGY_INPUT_VERSION = 'strategy-input-v1';
export const RECOMMENDATION_VERSION = 'recommendation-v1';

export function visionStateToStrategyInput(vision, context = {}) {
  if (!vision || vision.version !== 'vision-state-v1')
    throw new Error('VISION_STATE_V1_REQUIRED');

  return {
    version: STRATEGY_INPUT_VERSION,
    heroCards: [...vision.heroCards],
    board: [...vision.board],
    pot: vision.pot,
    heroStack: vision.heroStack,
    blinds: vision.blinds,
    legalActions: [...vision.legalActions],
    toCall: vision.toCall,

    // Deterministic/contextual fields live outside the eyes and may evolve in GitHub.
    heroPosition: context.heroPosition ?? null,
    actionHistory: Array.isArray(context.actionHistory) ? [...context.actionHistory] : [],
    node: context.node ?? null,
    versus: context.versus ?? null,
    multiway: context.multiway ?? null,
    depthBB: Number.isFinite(context.depthBB) ? context.depthBB : null,
    format: context.format ?? 'cash',
    tableSize: context.tableSize ?? '6max',
    decisionKey: context.decisionKey ?? null,

    visionObservedAt: vision.observedAt,
    visionSource: vision.source,
  };
}

export function recommendationV1(payload = {}) {
  return {
    version: RECOMMENDATION_VERSION,
    status: payload.status ?? 'analyzing',
    action: payload.action ?? null,
    label: payload.label ?? null,
    reason: payload.reason ?? null,
    confidence: payload.confidence ?? null,
    engine: payload.engine ?? null,
    alternative: payload.alternative ?? null,
    details: Array.isArray(payload.details) ? payload.details : [],
  };
}

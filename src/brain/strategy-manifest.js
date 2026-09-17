export const STRATEGY_V1_MANIFEST = Object.freeze({
  version: 'strategy-v1-migration',
  preflop: Object.freeze({
    id: 'cash6max-100z-highrake-v1',
    status: 'ported-and-regression-gated',
  }),
  postflop: Object.freeze({
    id: 'postflop-policy-v4',
    status: 'source-not-vendored-in-github',
    expectedModelSha256: 'bb98bc8a27ec4bb634ff380ec1315c3bc4cc7605a81a65ce0ece2848a4e27181',
    minimumPolicySupportPct: 45,
    mixedStrategyThresholdPp: 10,
    activeRuntimeFallback: 'postflop-brain-v1-provisional-heuristic',
  }),
  decisionLayer: Object.freeze({
    id: 'v4',
    status: 'source-not-vendored-in-github',
  }),
  policyComplete: false,
  notes: Object.freeze([
    'Vision is external input only and must not be imported by strategy modules.',
    'Do not call the provisional postflop heuristic Policy V4.',
    'Do not change frozen range/policy thresholds during parity migration.',
  ]),
});

export const STRATEGY_V1_MANIFEST = Object.freeze({
  version: 'strategy-v1-migration',
  preflop: Object.freeze({
    id: 'cash6max-100z-highrake-v1',
    status: 'ported-and-regression-gated',
  }),
  postflop: Object.freeze({
    id: 'postflop-policy-v4',
    status: 'exact-artifact-recovered-parity-pending',
    expectedModelSha256: 'bb98bc8a27ec4bb634ff380ec1315c3bc4cc7605a81a65ce0ece2848a4e27181',
    expectedArtifactByteSha256: 'd0e45d38963d77c0833b468d1f5dcf47f817347f4a7e6bce7c1431fa1b0bd573',
    expectedArtifactPath: 'src/strategy-v1/postflop-policy-model.js',
    artifactEncoding: 'lossless-js-chunks',
    frozenSourceProject: 'Hero Card Rescue',
    frozenSourceProjectId: 'a4352431-0461-41cd-bebc-1e1e617a190c',
    frozenSourceCommit: '3efde306fbb1dda38584cb8ffee0c2245b6231f4',
    minimumPolicySupportPct: 45,
    mixedStrategyThresholdPp: 10,
    activeRuntimeFallback: 'postflop-brain-v1-provisional-heuristic',
  }),
  decisionLayer: Object.freeze({
    id: 'v4',
    status: 'source-recovery-in-progress',
  }),
  policyComplete: false,
  notes: Object.freeze([
    'Vision is external input only and must not be imported by strategy modules.',
    'Exact frozen Policy V4 model artifact is recovered; runtime activation remains gated on feature and Decision Layer V4 parity.',
    'Do not call the provisional postflop heuristic Policy V4.',
    'Do not change frozen range/policy thresholds during parity migration.',
  ]),
});

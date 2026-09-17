import { VISION_VERSION, VISION_V1_FIELDS, normalizeVisionStateV1, validateVisionStateV1 } from '../src/core/vision-contract.js';
import { decideBrain } from '../src/brain/decision.js';
import { createStudySession, ingestVisionState } from '../src/brain/study-session.js';
import { combineActionSources } from '../src/brain/action-source.js';
import { STRATEGY_V1_MANIFEST } from '../src/brain/strategy-manifest.js';

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      service: 'poker-strategy-brain',
      status: 'brain-v1-ready',
      visionContract: VISION_VERSION,
      fields: VISION_V1_FIELDS,
      brainVersion: 'brain-v1',
      strategyVersion: STRATEGY_V1_MANIFEST.version,
      strategyStatus: {
        preflop: STRATEGY_V1_MANIFEST.preflop.status,
        postflop: STRATEGY_V1_MANIFEST.postflop.status,
        policyComplete: STRATEGY_V1_MANIFEST.policyComplete,
      },
      sessionRoundTrip: true,
      supplementalActionSources: ['handHistoryText','manualActionHistory'],
      policy: 'deterministic-first; no Lovable strategy calls',
      note: 'MTT/ICM modules are explicitly marked approximation until independently audited.',
    });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  // Accept either raw VisionStateV1 or {vision, context}.
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const rawVision = body.vision && typeof body.vision === 'object' ? body.vision : body;
  const context = body.vision && typeof body.context === 'object' && body.context ? body.context : {};
  const state = normalizeVisionStateV1(rawVision);

  // Optional reliable action sources can enrich the same canonical VisionState contract.
  // Vision remains eyes-only; merging and memory are owned here.
  state.actionHistory = combineActionSources({
    visionHistory: state.actionHistory,
    handHistoryText: typeof context.handHistoryText === 'string' ? context.handHistoryText : '',
    manualHistory: Array.isArray(context.manualActionHistory) ? context.manualActionHistory : [],
  });

  const check = validateVisionStateV1(state);
  if (!check.ok) return json(res, 422, { ok: false, error: 'INVALID_VISION_STATE', details: check.errors });

  // Serverless-safe memory: caller may round-trip the returned session object.
  // No hidden server state and no Lovable strategy/storage dependency.
  const wantsSession = context.useStudySession === true || (context.session && typeof context.session === 'object');
  let session = null;
  let decisionContext = { ...context };
  delete decisionContext.session;
  delete decisionContext.useStudySession;
  delete decisionContext.handHistoryText;
  delete decisionContext.manualActionHistory;

  if (wantsSession) {
    const baseSession = context.session && typeof context.session === 'object' ? context.session : createStudySession();
    session = ingestVisionState(baseSession, state, { handId: context.handId ?? null });
    decisionContext = {
      ...decisionContext,
      handId: session.handId || context.handId || null,
      heroActor: session.ledger?.heroActor ?? context.heroActor ?? null,
      profiles: session.profiles,
    };
  }

  const result = decideBrain(state, decisionContext);
  return json(res, 200, {
    ok: true,
    visionVersion: state.version,
    brainVersion: result.version,
    result,
    ...(session ? { session } : {}),
  });
}

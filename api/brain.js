import { VISION_VERSION, VISION_V1_FIELDS, normalizeVisionStateV1, validateVisionStateV1 } from '../src/core/vision-contract.js';
import { decideBrain } from '../src/brain/decision.js';
import { createStudySession, ingestVisionState, ingestCaptureEvents } from '../src/brain/study-session.js';
import { combineActionSources } from '../src/brain/action-source.js';
import { resolveSeatIdentity } from '../src/brain/seat-identity.js';
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
      seatIdentity: 'explicit-slot -> unique-stack-match -> opt-in ordered mapping; no guessing',
      supplementalActionSources: ['handHistoryText','manualActionHistory','localActionCapture','localActionText','localCommitmentInference'],
      localCapturePolicy: 'provisional until authoritative action history confirms; never sovereign by itself',
      policy: 'deterministic-first; no Lovable strategy calls',
      note: 'MTT/ICM modules are explicitly marked approximation until independently audited.',
    });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const rawVision = body.vision && typeof body.vision === 'object' ? body.vision : body;
  const context = body.vision && typeof body.context === 'object' && body.context ? body.context : {};
  const state = normalizeVisionStateV1(rawVision);

  state.actionHistory = combineActionSources({
    visionHistory: state.actionHistory,
    handHistoryText: typeof context.handHistoryText === 'string' ? context.handHistoryText : '',
    manualHistory: Array.isArray(context.manualActionHistory) ? context.manualActionHistory : [],
  });

  const check = validateVisionStateV1(state);
  if (!check.ok) return json(res, 422, { ok: false, error: 'INVALID_VISION_STATE', details: check.errors });

  const seatIdentity = resolveSeatIdentity(state.seats, {
    heroActor: context.heroActor ?? null,
    localStacks: context.captureLocalStacks && typeof context.captureLocalStacks === 'object' ? context.captureLocalStacks : {},
    orderedFromHero: context.seatsOrderedFromHero === true,
    orientation: context.seatOrientation === 'right' ? 'right' : 'left',
  });
  const providedSeatMap = context.captureSeatMap && typeof context.captureSeatMap === 'object' ? context.captureSeatMap : {};
  const captureSeatMap = Object.keys(providedSeatMap).length ? providedSeatMap : seatIdentity.map;

  const wantsSession = context.useStudySession === true || (context.session && typeof context.session === 'object');
  let session = null;
  let decisionContext = { ...context };
  for (const k of ['session','useStudySession','handHistoryText','manualActionHistory','captureEvents','captureSeatMap','captureLocalStacks','seatsOrderedFromHero','seatOrientation']) delete decisionContext[k];

  if (wantsSession) {
    const baseSession = context.session && typeof context.session === 'object' ? context.session : createStudySession();
    session = ingestVisionState(baseSession, state, { handId: context.handId ?? null });
    if (Array.isArray(context.captureEvents) && context.captureEvents.length) {
      session = ingestCaptureEvents(session, context.captureEvents, { seatMap: captureSeatMap });
    }
    decisionContext = {
      ...decisionContext,
      handId: session.handId || context.handId || null,
      heroActor: session.ledger?.heroActor ?? context.heroActor ?? null,
      profiles: session.profiles,
      ledger: session.ledger,
      captureCandidates: session.captureCandidates || [],
    };
  }

  const result = decideBrain(state, decisionContext);
  return json(res, 200, {
    ok: true,
    visionVersion: state.version,
    brainVersion: result.version,
    seatIdentity,
    result,
    ...(session ? { session } : {}),
  });
}

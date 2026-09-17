import { VISION_VERSION, VISION_V1_FIELDS, normalizeVisionStateV1, validateVisionStateV1 } from '../src/core/vision-contract.js';

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      service: 'poker-strategy-brain',
      status: 'contract-ready',
      visionContract: VISION_VERSION,
      fields: VISION_V1_FIELDS,
      strategy: 'strategy-v1-port-pending',
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const raw = req.body && typeof req.body === 'object' ? req.body : {};
  const state = normalizeVisionStateV1(raw);
  const check = validateVisionStateV1(state);
  if (!check.ok) {
    return json(res, 422, { ok: false, error: 'INVALID_VISION_STATE', details: check.errors });
  }

  // Deliberately no recommendation yet. We do not connect the older heuristic
  // strategy because it is weaker than the frozen Strategy V1 from the validated
  // Lovable project. The next milestone is to port that exact deterministic
  // strategy/policy stack here and only then emit decisions.
  return json(res, 200, {
    ok: true,
    accepted: true,
    visionVersion: state.version,
    capturedAt: state.capturedAt,
    normalizedState: state,
    strategyReady: false,
    decision: null,
    reason: 'VisionState v1 accepted. Strategy V1 exact port is not connected yet.',
  });
}

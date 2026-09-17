import { VISION_VERSION, VISION_V1_FIELDS, normalizeVisionStateV1, validateVisionStateV1 } from '../src/core/vision-contract.js';
import { decideBrain } from '../src/brain/decision.js';

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
  const check = validateVisionStateV1(state);
  if (!check.ok) return json(res, 422, { ok: false, error: 'INVALID_VISION_STATE', details: check.errors });

  const result = decideBrain(state, context);
  return json(res, 200, {
    ok: true,
    visionVersion: state.version,
    brainVersion: result.version,
    result,
  });
}

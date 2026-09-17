import { normalizeVisionState } from './vision-contract.js';

export const LOVABLE_VISION_BASE_URL = 'https://poker-vision-gateway.lovable.app';

export async function lovableVisionHealth(fetchImpl = fetch) {
  const response = await fetchImpl(`${LOVABLE_VISION_BASE_URL}/api/vision/health`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `LOVABLE_VISION_HEALTH_${response.status}`);
  return body;
}

export async function readLovableVision({ image, mode = 'fast', scope, knownHero, knownBoard, knownPot, knownToCall }, fetchImpl = fetch) {
  if (typeof image !== 'string' || image.length < 100) throw new Error('INVALID_IMAGE');
  if (!['quick', 'hero', 'board', 'actions', 'full'].includes(scope)) throw new Error('INVALID_SCOPE');
  if (!['fast', 'precise'].includes(mode)) throw new Error('INVALID_MODE');

  const started = Date.now();
  const response = await fetchImpl(`${LOVABLE_VISION_BASE_URL}/api/vision/read`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      image,
      mode,
      scope,
      ...(knownHero !== undefined ? { knownHero } : {}),
      ...(knownBoard !== undefined ? { knownBoard } : {}),
      ...(knownPot !== undefined ? { knownPot } : {}),
      ...(knownToCall !== undefined ? { knownToCall } : {}),
    }),
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(raw?.error || `LOVABLE_VISION_${response.status}`);
    error.status = response.status;
    error.payload = raw;
    throw error;
  }

  return {
    raw,
    state: normalizeVisionState(raw),
    proxyMs: Date.now() - started,
    visionMs: Number.isFinite(raw?.totalMs) ? Number(raw.totalMs) : null,
  };
}

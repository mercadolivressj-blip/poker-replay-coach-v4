const UPSTREAM = 'https://poker-vision-gateway.lovable.app';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  const started = Date.now();
  const body = req.body || {};
  if (typeof body.image !== 'string' || body.image.length < 100)
    return res.status(400).json({ error: 'INVALID_IMAGE' });
  if (!['quick','hero','board','actions','full'].includes(body.scope))
    return res.status(400).json({ error: 'INVALID_SCOPE' });
  if (!['fast','precise'].includes(body.mode || 'fast'))
    return res.status(400).json({ error: 'INVALID_MODE' });

  try {
    const upstreamStarted = Date.now();
    const r = await fetch(`${UPSTREAM}/api/vision/read`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'poker-replay-coach-hybrid-v1/1.0',
      },
      body: JSON.stringify({
        image: body.image,
        mode: body.mode || 'fast',
        scope: body.scope,
        ...(body.knownHero !== undefined ? { knownHero: body.knownHero } : {}),
        ...(body.knownBoard !== undefined ? { knownBoard: body.knownBoard } : {}),
        ...(body.knownPot !== undefined ? { knownPot: body.knownPot } : {}),
        ...(body.knownToCall !== undefined ? { knownToCall: body.knownToCall } : {}),
      }),
    });
    const payload = await r.json().catch(() => ({}));
    if (!r.ok)
      return res.status(r.status).json({
        error: payload?.error || `LOVABLE_VISION_${r.status}`,
        totalMs: Date.now() - started,
        upstreamMs: Date.now() - upstreamStarted,
        backend: 'lovable-vision-v1-proxy',
      });

    return res.status(200).json({
      ...payload,
      visionMs: Number.isFinite(payload?.totalMs) ? payload.totalMs : null,
      totalMs: Date.now() - started,
      upstreamMs: Date.now() - upstreamStarted,
      backend: 'lovable-vision-v1-proxy',
      visionVersion: 'vision-state-v1',
      visionSource: 'lovable-vision-v1',
    });
  } catch (error) {
    return res.status(502).json({
      error: String(error?.message || error),
      totalMs: Date.now() - started,
      backend: 'lovable-vision-v1-proxy',
    });
  }
}

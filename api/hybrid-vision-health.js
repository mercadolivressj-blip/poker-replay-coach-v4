const UPSTREAM = 'https://poker-vision-gateway.lovable.app';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  const started = Date.now();
  try {
    const r = await fetch(`${UPSTREAM}/api/vision/health`, {
      headers: { accept: 'application/json', 'user-agent': 'poker-replay-coach-hybrid-v1/1.0' },
    });
    const upstream = await r.json().catch(() => ({}));
    return res.status(r.ok ? 200 : 502).json({
      ok: r.ok && upstream?.ok !== false,
      backend: 'lovable-vision-v1-proxy',
      visionVersion: 'vision-state-v1',
      upstream: upstream?.backend || 'lovable-priority',
      upstreamVersion: upstream?.version || null,
      strategyOwner: 'github-vercel',
      visionOwner: 'lovable-frozen',
      totalMs: Date.now() - started,
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      backend: 'lovable-vision-v1-proxy',
      error: String(error?.message || error),
      totalMs: Date.now() - started,
    });
  }
}

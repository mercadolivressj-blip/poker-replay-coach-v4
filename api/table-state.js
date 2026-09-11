import crypto from 'node:crypto';

const STREETS = ['preflop', 'flop', 'turn', 'river'];

function extractOutputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  for (const item of response?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return '';
}

function tokenMatches(expected, provided) {
  if (!expected) return true;
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function schema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      seats: {
        type: 'array',
        maxItems: 10,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            seatIndex: { type: 'integer', minimum: 0, maximum: 9 },
            actorName: { type: ['string', 'null'], maxLength: 64 },
            stack: { type: ['number', 'null'], minimum: 0 },
            committed: { type: ['number', 'null'], minimum: 0 },
            dealer: { type: 'boolean' },
            folded: { type: ['boolean', 'null'] },
            hero: { type: 'boolean' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['seatIndex', 'actorName', 'stack', 'committed', 'dealer', 'folded', 'hero', 'confidence'],
        },
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['seats', 'confidence'],
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(501).json({ error: 'OPENAI_API_KEY not configured' });
  const accessToken = process.env.VISION_ACCESS_TOKEN;
  if (process.env.VERCEL_ENV === 'production' && !accessToken)
    return res.status(501).json({ error: 'VISION_ACCESS_TOKEN not configured' });
  const providedToken = req.headers?.['x-coach-token'] ?? req.headers?.['X-Coach-Token'];
  if (!tokenMatches(accessToken, providedToken)) return res.status(401).json({ error: 'coach auth required' });

  const { mode, image, handId, street, fingerprint = null } = req.body || {};
  if (mode !== 'replay') return res.status(400).json({ error: 'replay mode required' });
  if (!Number.isInteger(handId) || handId < 1) return res.status(400).json({ error: 'invalid handId' });
  if (!STREETS.includes(street)) return res.status(400).json({ error: 'invalid street' });
  if (typeof image !== 'string' || !image.startsWith('data:image/')) return res.status(400).json({ error: 'image required' });
  if (image.length > 2_500_000) return res.status(413).json({ error: 'image too large' });
  if (fingerprint !== null && (typeof fingerprint !== 'string' || fingerprint.length > 256)) return res.status(400).json({ error: 'invalid fingerprint' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7500);
  const t0 = Date.now();
  const prompt = [
    'Poker replay/simulation screenshot only. Read the visible table state; this is never live real-money assistance.',
    'Return one entry per clearly visible occupied seat, clockwise starting from the top-most/left-most reasonable seat as seatIndex 0 and continuing consistently around the table.',
    'Read only text/numbers/markers physically visible in the screenshot: player display name, visible stack, chips visibly committed in front of the seat, dealer/button marker, whether the seat is visibly folded/inactive, and whether it is Hero.',
    'Do NOT infer hidden cards, strategy, action history, position labels, missing stacks, or a fold merely because cards are not visible.',
    'If a value is not clearly readable, use null and lower confidence. committed is only the chips/bet visibly placed for the CURRENT street, not total pot contribution.',
    'dealer=true only when a dealer/button marker is visibly associated with that seat. hero=true only when the seat is clearly the Hero seat from the visible table layout.',
    'Never fabricate a player or numeric value. Precision is more important than coverage.',
  ].join('\n');

  try {
    const body = {
      model: 'gpt-5.6-sol',
      reasoning: { effort: 'low' },
      store: false,
      max_output_tokens: 1200,
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: image, detail: 'high' }] }],
      text: { format: { type: 'json_schema', name: 'poker_replay_table_state', strict: true, schema: schema() } },
    };
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || 'table vision failed' });
    let parsed;
    try { parsed = JSON.parse(extractOutputText(j) || '{}'); }
    catch { return res.status(502).json({ error: 'invalid table-state json' }); }
    const seats = Array.isArray(parsed.seats) ? parsed.seats
      .filter((s) => s && Number.isInteger(s.seatIndex) && Number.isFinite(s.confidence) && s.confidence >= 0.5)
      .map((s) => ({
        seatIndex: s.seatIndex,
        actorName: typeof s.actorName === 'string' && s.actorName.trim() ? s.actorName.trim().slice(0, 64) : null,
        stack: Number.isFinite(s.stack) ? s.stack : null,
        committed: Number.isFinite(s.committed) ? s.committed : null,
        dealer: Boolean(s.dealer),
        folded: typeof s.folded === 'boolean' ? s.folded : null,
        hero: Boolean(s.hero),
        confidence: s.confidence,
      })) : [];
    return res.status(200).json({ seats, confidence: Number(parsed.confidence) || 0, handId, street, fingerprint, ms: Date.now() - t0 });
  } catch (e) {
    if (e?.name === 'AbortError') return res.status(504).json({ error: 'table vision timeout' });
    return res.status(502).json({ error: 'table vision request failed' });
  } finally {
    clearTimeout(timer);
  }
}

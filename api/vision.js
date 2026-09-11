import crypto from 'node:crypto';

function extractOutputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  for (const item of response?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return '';
}

const VALID_COUNTS = { hero: [2], board: [0, 3, 4, 5] };
const VALID_STREETS = ['preflop', 'flop', 'turn', 'river'];
const ACTIONS = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];

function tokenMatches(expected, provided) {
  if (!expected) return true;
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cardSchema(expected) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      cards: {
        type: 'array',
        minItems: expected,
        maxItems: expected,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            rank: { type: 'string', enum: ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] },
            suit: { type: ['string', 'null'], enum: ['clubs', 'diamonds', 'hearts', 'spades', null] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['rank', 'suit', 'confidence'],
        },
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['cards', 'confidence'],
  };
}

function actionLogSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      events: {
        type: 'array',
        maxItems: 18,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            actorName: { type: 'string', minLength: 1, maxLength: 64 },
            action: { type: 'string', enum: ACTIONS },
            amount: { type: ['number', 'null'] },
            street: { type: ['string', 'null'], enum: [...VALID_STREETS, null] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['actorName', 'action', 'amount', 'street', 'confidence'],
        },
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['events', 'confidence'],
  };
}

async function askVision({ key, image, schema, schemaName, prompt, controller }) {
  const body = {
    model: 'gpt-5.6-sol',
    reasoning: { effort: 'low' },
    store: false,
    max_output_tokens: 900,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: image, detail: 'high' },
        ],
      },
    ],
    text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } },
  };
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  const j = await r.json();
  return { r, j, body };
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
  if (!tokenMatches(accessToken, providedToken)) return res.status(401).json({ error: 'vision auth required' });

  const { kind, image, handId, expectedCount, fingerprint = null, street = null } = req.body || {};
  if (!['hero', 'board', 'action_log'].includes(kind) || !Number.isInteger(handId))
    return res.status(400).json({ error: 'invalid input' });
  if (typeof image !== 'string' || !image.startsWith('data:image/'))
    return res.status(400).json({ error: 'image must be a data URL' });
  if (image.length > 2_500_000) return res.status(413).json({ error: 'image too large' });
  if (fingerprint !== null && (typeof fingerprint !== 'string' || fingerprint.length > 256))
    return res.status(400).json({ error: 'invalid fingerprint' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const t0 = Date.now();
  try {
    let schema;
    let prompt;
    let schemaName;
    let expected = null;

    if (kind === 'action_log') {
      if (!VALID_STREETS.includes(street)) return res.status(400).json({ error: 'invalid street' });
      schema = actionLogSchema();
      schemaName = 'poker_replay_actions';
      prompt =
        `Poker replay/simulation screenshot only. Current detected street is ${street}. ` +
        'Extract ONLY explicit textual action-history/dealer-log events that are clearly visible in the screenshot. ' +
        'Do not infer actions from chip stacks, animations, player posture, hidden cards, or strategic assumptions. ' +
        'If no readable action log is visible, return events=[] and confidence=0. ' +
        'Keep visible events in chronological order. actorName must match the visible name. ' +
        'For raises like "raises 200 to 600", amount is the final total 600. ' +
        'Set street only when the visible log/section makes it clear; otherwise use null. ' +
        'Never guess opponent hole cards and never describe a bluff as confirmed.';
    } else {
      const allowed = VALID_COUNTS[kind];
      expected = kind === 'hero' ? 2 : Number(expectedCount);
      if (!allowed.includes(expected)) return res.status(400).json({ error: 'invalid expectedCount' });
      schema = cardSchema(expected);
      schemaName = 'poker_cards';
      const target =
        kind === 'hero'
          ? 'the exactly two face-up hero cards, left to right'
          : `the exactly ${expected} community cards that are physically visible, left to right`;
      prompt =
        `Poker replay/simulation crop only. Read ${target}. ` +
        'Never infer a hidden/covered card, never use chip values or text outside card faces as ranks. ' +
        'Rank T means ten. If a suit is genuinely not legible, return null suit and lower that card confidence. ' +
        `The physical detector has already established expectedCount=${expected}; return exactly that many cards.`;
    }

    const { r, j } = await askVision({ key, image, schema, schemaName, prompt, controller });
    if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || 'vision failed' });
    const text = extractOutputText(j);
    let parsed;
    try {
      parsed = JSON.parse(text || '{}');
    } catch {
      return res.status(502).json({ error: 'invalid vision json' });
    }

    if (kind === 'action_log') {
      if (!Array.isArray(parsed.events)) return res.status(422).json({ error: 'events missing' });
      const events = parsed.events
        .filter((e) => e && typeof e.actorName === 'string' && ACTIONS.includes(e.action))
        .map((e) => ({
          actorName: e.actorName.trim(),
          action: e.action,
          amount: Number.isFinite(e.amount) ? e.amount : null,
          street: VALID_STREETS.includes(e.street) ? e.street : null,
          confidence: Number.isFinite(e.confidence) ? e.confidence : 0,
        }))
        .filter((e) => e.actorName && e.confidence >= 0.55);
      return res.status(200).json({ events, confidence: Number(parsed.confidence) || 0, handId, street, fingerprint, ms: Date.now() - t0 });
    }

    if (!Array.isArray(parsed.cards) || parsed.cards.length !== expected)
      return res.status(422).json({ error: 'card count mismatch' });
    return res.status(200).json({ ...parsed, handId, expectedCount: expected, fingerprint, ms: Date.now() - t0 });
  } catch (e) {
    if (e?.name === 'AbortError') return res.status(504).json({ error: 'vision timeout' });
    return res.status(502).json({ error: 'vision request failed' });
  } finally {
    clearTimeout(timer);
  }
}

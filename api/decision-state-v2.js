import crypto from 'node:crypto';

const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS = ['clubs','diamonds','hearts','spades'];
const ACTIONS = ['fold','check','call','bet','raise','allin'];

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

const cardSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    rank: { type: 'string', enum: RANKS },
    suit: { type: 'string', enum: SUITS },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['rank','suit','confidence'],
};

const actionSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ACTIONS },
    amount: { type: ['number','null'], minimum: 0 },
  },
  required: ['type','amount'],
};

function schema() {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      hero: { type: 'array', minItems: 0, maxItems: 2, items: cardSchema },
      board: { type: 'array', minItems: 0, maxItems: 5, items: cardSchema },
      pot: { type: ['number','null'], minimum: 0 },
      potLabelText: { type: ['string','null'], maxLength: 48 },
      heroToAct: { type: ['boolean','null'] },
      heroActions: { type: 'array', maxItems: 5, items: actionSchema },
      aggressorName: { type: ['string','null'], maxLength: 64 },
      aggressorCommitted: { type: ['number','null'], minimum: 0 },
      heroCommitted: { type: ['number','null'], minimum: 0 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      heroConfidence: { type: 'number', minimum: 0, maximum: 1 },
      boardConfidence: { type: 'number', minimum: 0, maximum: 1 },
      potConfidence: { type: 'number', minimum: 0, maximum: 1 },
      actionsConfidence: { type: 'number', minimum: 0, maximum: 1 },
      aggressorConfidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['hero','board','pot','potLabelText','heroToAct','heroActions','aggressorName','aggressorCommitted','heroCommitted','confidence','heroConfidence','boardConfidence','potConfidence','actionsConfidence','aggressorConfidence'],
  };
}

function prompt() {
  return [
    'Poker REPLAY / post-game study only. Read the CURRENT visible public decision state. Never provide strategy.',
    'You receive three images from the same replay frame: A = whole table, B = enlarged center/pot region, C = enlarged Hero/action-controls region.',
    'Use A for identity/context, B as the PRIMARY source for the central pot label, and C as the PRIMARY source for Hero cards and current action buttons.',
    'Hero: exactly two face-up Hero cards only. Never read opponent hole cards.',
    'Board: community cards left-to-right; valid lengths 0, 3, 4 or 5.',
    'Pot: copy the CENTRAL label that literally says Pote/Pot. Read every digit carefully from image B. Do not use a nearby contribution or chip stack. If the central label is not clearly readable, pot=null instead of guessing.',
    'potLabelText: copy the short visible central pot label exactly enough to audit the number, e.g. "Pote: 211" or "Pote: 2.508".',
    'heroToAct=true only if Hero currently has an active decision. If the table already displays Hero action text such as Aumento/Pago/Desisto and the decision buttons are gone, heroToAct=false.',
    'heroActions: read only CURRENT Hero decision buttons from image C. Include exact numeric amount when printed. Examples: Pago 250 => call 250; Aumento para 500 => raise 500; Passo => check; Desisto => fold.',
    'aggressorName must be an actual visible player nickname from image A. Never return action words such as Aumento, Raise, Pago, Call, All-in, Desisto, Bet or Fold as a player name.',
    'aggressorName is the opponent responsible for the largest live wager Hero is facing. aggressorCommitted is that opponent current total commitment on the street. heroCommitted is Hero current street commitment.',
    'Portuguese formatting: comma is decimal in cash games; dots can be thousands separators in tournament chips, e.g. 2.508 means 2508.',
    'Precision over coverage. Use null / lower confidence instead of guessing.',
  ].join('\n');
}

function imagePart(image) {
  return { type: 'input_image', image_url: image, detail: 'high' };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  const key = process.env.OPENAI_API_KEY || process.env.CHATGPT;
  if (!key) return res.status(501).json({ error: 'OpenAI API key not configured' });
  const accessToken = process.env.VISION_ACCESS_TOKEN;
  if (process.env.VERCEL_ENV === 'production' && accessToken) {
    const provided = req.headers?.['x-coach-token'] ?? req.headers?.['X-Coach-Token'];
    if (!tokenMatches(accessToken, provided)) return res.status(401).json({ error: 'coach auth required' });
  }

  const { mode, image, potImage, actionImage, handId, fingerprint = null } = req.body || {};
  if (mode !== 'replay') return res.status(400).json({ error: 'replay mode required' });
  if (!Number.isInteger(handId) || handId < 1) return res.status(400).json({ error: 'invalid handId' });
  for (const [name, value] of [['image', image], ['potImage', potImage], ['actionImage', actionImage]]) {
    if (typeof value !== 'string' || !value.startsWith('data:image/')) return res.status(400).json({ error: `${name} required` });
    if (value.length > 2_500_000) return res.status(413).json({ error: `${name} too large` });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const t0 = Date.now();
  try {
    const content = [
      { type: 'input_text', text: prompt() + '\nIMAGE A · FULL TABLE' },
      imagePart(image),
      { type: 'input_text', text: 'IMAGE B · ENLARGED CENTER / POT LABEL' },
      imagePart(potImage),
      { type: 'input_text', text: 'IMAGE C · ENLARGED HERO / ACTION CONTROLS' },
      imagePart(actionImage),
    ];
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        reasoning: { effort: 'none' },
        store: false,
        max_output_tokens: 620,
        input: [{ role: 'user', content }],
        text: { format: { type: 'json_schema', name: 'poker_replay_decision_state_v2', strict: true, schema: schema() } },
      }),
      signal: controller.signal,
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || 'decision vision v2 failed' });

    let parsed;
    try { parsed = JSON.parse(extractOutputText(j) || '{}'); }
    catch { return res.status(502).json({ error: 'invalid decision v2 json' }); }

    const board = Array.isArray(parsed.board) && [0,3,4,5].includes(parsed.board.length) ? parsed.board : [];
    const hero = Array.isArray(parsed.hero) && parsed.hero.length === 2 ? parsed.hero : [];
    const heroActions = Array.isArray(parsed.heroActions) ? parsed.heroActions
      .filter((a) => a && ACTIONS.includes(a.type))
      .map((a) => ({ type: a.type, amount: Number.isFinite(a.amount) ? a.amount : null })) : [];

    const out = {
      handId,
      fingerprint,
      model: 'gpt-5.6-luna',
      hero,
      board,
      pot: Number.isFinite(parsed.pot) && parsed.pot > 0 ? parsed.pot : null,
      potLabelText: typeof parsed.potLabelText === 'string' ? parsed.potLabelText.slice(0,48) : null,
      heroToAct: typeof parsed.heroToAct === 'boolean' ? parsed.heroToAct : null,
      heroActions,
      aggressorName: typeof parsed.aggressorName === 'string' && parsed.aggressorName.trim() ? parsed.aggressorName.trim().slice(0,64) : null,
      aggressorCommitted: Number.isFinite(parsed.aggressorCommitted) ? parsed.aggressorCommitted : null,
      heroCommitted: Number.isFinite(parsed.heroCommitted) ? parsed.heroCommitted : null,
      confidence: Number(parsed.confidence) || 0,
      heroConfidence: Number(parsed.heroConfidence) || 0,
      boardConfidence: Number(parsed.boardConfidence) || 0,
      potConfidence: Number(parsed.potConfidence) || 0,
      actionsConfidence: Number(parsed.actionsConfidence) || 0,
      aggressorConfidence: Number(parsed.aggressorConfidence) || 0,
      ms: Date.now() - t0,
    };

    console.info('[decision-v2]', JSON.stringify({
      handId: out.handId,
      pot: out.pot,
      potLabelText: out.potLabelText,
      heroToAct: out.heroToAct,
      actions: out.heroActions,
      aggressorName: out.aggressorName,
      aggressorCommitted: out.aggressorCommitted,
      heroCommitted: out.heroCommitted,
      confidence: out.confidence,
      ms: out.ms,
    }));

    return res.status(200).json(out);
  } catch (e) {
    if (e?.name === 'AbortError') return res.status(504).json({ error: 'decision vision v2 timeout' });
    return res.status(502).json({ error: 'decision vision v2 request failed' });
  } finally {
    clearTimeout(timer);
  }
}

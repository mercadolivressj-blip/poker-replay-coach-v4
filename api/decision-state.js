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
    required: ['hero','board','pot','heroToAct','heroActions','aggressorName','aggressorCommitted','heroCommitted','confidence','heroConfidence','boardConfidence','potConfidence','actionsConfidence','aggressorConfidence'],
  };
}

function prompt() {
  return [
    'Poker REPLAY / post-game study screenshot. Read ONLY the current decision-critical public state. Never provide strategy.',
    'Inspect the whole image, but answer compactly and do not spend time cataloguing every seat.',
    'Hero: return the two face-up hero cards only. Never read opponent hole cards.',
    'Board: return the community cards left-to-right; valid lengths are 0, 3, 4 or 5.',
    'Pot: read ONLY the central label "Pote: US$ ...". Do not confuse a player contribution with the pot.',
    'heroToAct=true only if the bottom hero controls clearly show an active decision.',
    'heroActions: read the CURRENT visible hero decision buttons. Include numeric amounts when printed. Examples: "Pago US$ 0,04" => call 0.04; "Aumento para US$ 0,10" => raise 0.10; "Passo" => check; "Desisto" => fold.',
    'aggressorName: return ONLY the exact visible PLAYER NICKNAME of the opponent responsible for the largest live wager Hero is facing. Never return an action word or button label such as Aumento, Raise, Pago, Call, Desisto, Fold, Aposta, Bet, Passo or Check. If you cannot match the wager to a readable nickname, return null.',
    'Use explicit Bet/Raise action text attached to a player or the largest visible committed-chip label to identify that player.',
    'aggressorCommitted: current total amount visibly committed by that opponent on this street. heroCommitted: current amount visibly committed by Hero on this street.',
    'Portuguese decimal comma is decimal: US$ 0,08 = 0.08.',
    'Use null / lower confidence instead of guessing.',
  ].join('\n');
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

  const { mode, image, handId, fingerprint = null } = req.body || {};
  if (mode !== 'replay') return res.status(400).json({ error: 'replay mode required' });
  if (!Number.isInteger(handId) || handId < 1) return res.status(400).json({ error: 'invalid handId' });
  if (typeof image !== 'string' || !image.startsWith('data:image/')) return res.status(400).json({ error: 'image required' });
  if (image.length > 2_000_000) return res.status(413).json({ error: 'image too large' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  const t0 = Date.now();
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        reasoning: { effort: 'none' },
        store: false,
        max_output_tokens: 520,
        input: [{ role: 'user', content: [
          { type: 'input_text', text: prompt() },
          { type: 'input_image', image_url: image, detail: 'high' },
        ]}],
        text: { format: { type: 'json_schema', name: 'poker_replay_decision_state', strict: true, schema: schema() } },
      }),
      signal: controller.signal,
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || 'decision vision failed' });
    let parsed;
    try { parsed = JSON.parse(extractOutputText(j) || '{}'); }
    catch { return res.status(502).json({ error: 'invalid decision json' }); }

    const board = Array.isArray(parsed.board) && [0,3,4,5].includes(parsed.board.length) ? parsed.board : [];
    const hero = Array.isArray(parsed.hero) && parsed.hero.length === 2 ? parsed.hero : [];
    const heroActions = Array.isArray(parsed.heroActions) ? parsed.heroActions
      .filter((a) => a && ACTIONS.includes(a.type))
      .map((a) => ({ type: a.type, amount: Number.isFinite(a.amount) ? a.amount : null })) : [];

    return res.status(200).json({
      handId,
      fingerprint,
      model: 'gpt-5.6-luna',
      hero,
      board,
      pot: Number.isFinite(parsed.pot) && parsed.pot > 0 ? parsed.pot : null,
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
    });
  } catch (e) {
    if (e?.name === 'AbortError') return res.status(504).json({ error: 'decision vision timeout' });
    return res.status(502).json({ error: 'decision vision request failed' });
  } finally {
    clearTimeout(timer);
  }
}

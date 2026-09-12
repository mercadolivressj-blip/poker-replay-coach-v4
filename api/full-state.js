import crypto from 'node:crypto';

const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS = ['clubs','diamonds','hearts','spades'];
const STREETS = ['preflop','flop','turn','river'];
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
  type: 'object',
  additionalProperties: false,
  properties: {
    rank: { type: 'string', enum: RANKS },
    suit: { type: 'string', enum: SUITS },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['rank','suit','confidence'],
};

function schema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      tableSize: { type: ['integer','null'], enum: [2,3,4,5,6,7,8,9,10,null] },
      hero: { type: 'array', minItems: 0, maxItems: 2, items: cardSchema },
      board: { type: 'array', minItems: 0, maxItems: 5, items: cardSchema },
      pot: { type: ['number','null'], minimum: 0 },
      street: { type: 'string', enum: STREETS },
      heroToAct: { type: ['boolean','null'] },
      seats: {
        type: 'array',
        maxItems: 10,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            seatIndex: { type: 'integer', minimum: 0, maximum: 9 },
            actorName: { type: ['string','null'], maxLength: 64 },
            stack: { type: ['number','null'], minimum: 0 },
            committed: { type: ['number','null'], minimum: 0 },
            dealer: { type: 'boolean' },
            folded: { type: ['boolean','null'] },
            hero: { type: 'boolean' },
            visibleAction: { type: ['string','null'], enum: [...ACTIONS, null] },
            visibleActionAmount: { type: ['number','null'], minimum: 0 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['seatIndex','actorName','stack','committed','dealer','folded','hero','visibleAction','visibleActionAmount','confidence'],
        },
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      heroConfidence: { type: 'number', minimum: 0, maximum: 1 },
      boardConfidence: { type: 'number', minimum: 0, maximum: 1 },
      potConfidence: { type: 'number', minimum: 0, maximum: 1 },
      seatsConfidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['tableSize','hero','board','pot','street','heroToAct','seats','confidence','heroConfidence','boardConfidence','potConfidence','seatsConfidence'],
  };
}

function prompt() {
  return [
    'This is a poker REPLAY / post-game study screenshot. Read ONLY the visible public state in this single frame. Never provide strategy.',
    'Treat the full screenshot like a human visual inspection, not OCR fragments. Use the whole table geometry and labels together.',
    'Return the HERO hole cards only when the two bottom/hero cards are clearly face-up. Never return opponent hole cards, even if exposed at showdown.',
    'Return community cards left-to-right. Board length must be exactly 0, 3, 4, or 5. Street must agree with board length: 0=preflop, 3=flop, 4=turn, 5=river.',
    'Read the central pot label exactly. Portuguese decimal comma means decimal: "US$ 0,12" = 0.12. A thousands separator like "1.497" in tournament chips means 1497. Do not confuse a player bet/stack with the central pot.',
    'Read every physical seat visible around the table, including occupied, folded/inactive, sitting-out/away and hero. Use stable screen-position seat indexes clockwise starting at the top-most physical seat as seatIndex 0. Do not renumber when seats are empty.',
    'For each seat read visible nickname, current visible stack, chips visibly committed in front of that seat on the CURRENT street, dealer/button marker, fold/inactive state, hero flag, and any explicit action text currently visible.',
    'PokerStars action text may be Portuguese or English. Map visible text to fold/check/call/bet/raise/allin. visibleAction must be null when no explicit action label is visible; do not invent prior action history.',
    'heroToAct=true only when the Hero action controls/timer clearly show it is Hero turn. false only when clearly not Hero turn. null when uncertain.',
    'tableSize is the physical table format/seat capacity if clear from visible seat layout or title; otherwise null.',
    'Precision over coverage: if a nickname, stack, committed amount, pot, dealer marker, action or state is not genuinely readable, return null/false as appropriate and lower confidence. Never fabricate.',
    'Do not infer hidden information, opponent cards, strategic ranges, or earlier actions that are no longer visible.',
  ].join('\n');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  const key = process.env.OPENAI_API_KEY || process.env.CHATGPT;
  if (!key) return res.status(501).json({ error: 'OpenAI API key not configured (OPENAI_API_KEY or CHATGPT)' });
  const accessToken = process.env.VISION_ACCESS_TOKEN;
  const production = process.env.VERCEL_ENV === 'production';
  if (production && !accessToken) return res.status(501).json({ error: 'VISION_ACCESS_TOKEN not configured' });
  const providedToken = req.headers?.['x-coach-token'] ?? req.headers?.['X-Coach-Token'];
  if (production && !tokenMatches(accessToken, providedToken)) return res.status(401).json({ error: 'coach auth required' });

  const { mode, image, handId, fingerprint = null } = req.body || {};
  if (mode !== 'replay') return res.status(400).json({ error: 'replay mode required' });
  if (!Number.isInteger(handId) || handId < 1) return res.status(400).json({ error: 'invalid handId' });
  if (typeof image !== 'string' || !image.startsWith('data:image/')) return res.status(400).json({ error: 'image required' });
  if (image.length > 2_500_000) return res.status(413).json({ error: 'image too large' });
  if (fingerprint !== null && (typeof fingerprint !== 'string' || fingerprint.length > 256)) return res.status(400).json({ error: 'invalid fingerprint' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const t0 = Date.now();
  try {
    const body = {
      model: 'gpt-5.6-sol',
      reasoning: { effort: 'low' },
      store: false,
      max_output_tokens: 2200,
      input: [{ role: 'user', content: [
        { type: 'input_text', text: prompt() },
        { type: 'input_image', image_url: image, detail: 'high' },
      ] }],
      text: { format: { type: 'json_schema', name: 'poker_replay_full_state', strict: true, schema: schema() } },
    };

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || 'full-state vision failed' });

    let parsed;
    try { parsed = JSON.parse(extractOutputText(j) || '{}'); }
    catch { return res.status(502).json({ error: 'invalid full-state json' }); }

    const board = Array.isArray(parsed.board) && [0,3,4,5].includes(parsed.board.length) ? parsed.board : [];
    const street = board.length === 5 ? 'river' : board.length === 4 ? 'turn' : board.length === 3 ? 'flop' : 'preflop';
    const hero = Array.isArray(parsed.hero) && parsed.hero.length === 2 ? parsed.hero : [];
    const seats = Array.isArray(parsed.seats) ? parsed.seats
      .filter((s) => s && Number.isInteger(s.seatIndex) && Number.isFinite(s.confidence))
      .map((s) => ({
        seatIndex: s.seatIndex,
        actorName: typeof s.actorName === 'string' && s.actorName.trim() ? s.actorName.trim().slice(0,64) : null,
        stack: Number.isFinite(s.stack) ? s.stack : null,
        committed: Number.isFinite(s.committed) ? s.committed : null,
        dealer: Boolean(s.dealer),
        folded: typeof s.folded === 'boolean' ? s.folded : null,
        hero: Boolean(s.hero),
        visibleAction: ACTIONS.includes(s.visibleAction) ? s.visibleAction : null,
        visibleActionAmount: Number.isFinite(s.visibleActionAmount) ? s.visibleActionAmount : null,
        confidence: Math.max(0, Math.min(1, s.confidence)),
      })) : [];

    return res.status(200).json({
      handId,
      fingerprint,
      tableSize: Number.isInteger(parsed.tableSize) ? parsed.tableSize : null,
      hero,
      board,
      pot: Number.isFinite(parsed.pot) && parsed.pot > 0 ? parsed.pot : null,
      street,
      heroToAct: typeof parsed.heroToAct === 'boolean' ? parsed.heroToAct : null,
      seats,
      confidence: Number(parsed.confidence) || 0,
      heroConfidence: Number(parsed.heroConfidence) || 0,
      boardConfidence: Number(parsed.boardConfidence) || 0,
      potConfidence: Number(parsed.potConfidence) || 0,
      seatsConfidence: Number(parsed.seatsConfidence) || 0,
      ms: Date.now() - t0,
    });
  } catch (e) {
    if (e?.name === 'AbortError') return res.status(504).json({ error: 'full-state vision timeout' });
    return res.status(502).json({ error: 'full-state vision request failed' });
  } finally {
    clearTimeout(timer);
  }
}

import crypto from 'node:crypto';

const STREETS = ['preflop', 'flop', 'turn', 'river'];
const ACTIONS = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];
const DECISIONS = ['fold', 'check', 'call', 'bet', 'raise', 'allin', 'insufficient'];

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

function finiteOrNull(v) { return Number.isFinite(v) ? v : null; }
function text(v, max = 160) { return typeof v === 'string' ? v.slice(0, max) : null; }

function sanitizeCard(c) {
  if (!c || !'23456789TJQKA'.includes(String(c.rank || '').toUpperCase())) return null;
  const suit = ['clubs', 'diamonds', 'hearts', 'spades'].includes(c.suit) ? c.suit : null;
  return { rank: String(c.rank).toUpperCase(), suit, confidence: finiteOrNull(c.confidence) };
}

function sanitizePayload(body) {
  const p = body || {};
  if (p.mode !== 'replay') return { error: 'replay mode required' };
  if (!Number.isInteger(p.handId) || p.handId < 1) return { error: 'invalid handId' };
  if (!STREETS.includes(p.street)) return { error: 'invalid street' };
  if (typeof p.fingerprint !== 'string' || !p.fingerprint || p.fingerprint.length > 512) return { error: 'invalid fingerprint' };

  const hero = Array.isArray(p.hero) ? p.hero.map(sanitizeCard).filter(Boolean).slice(0, 2) : [];
  const board = Array.isArray(p.board) ? p.board.map(sanitizeCard).filter(Boolean).slice(0, 5) : [];
  const actions = Array.isArray(p.actions)
    ? p.actions.filter((a) => ACTIONS.includes(a?.type)).slice(0, 6).map((a) => ({ type: a.type, amount: finiteOrNull(a.amount) }))
    : [];
  const events = Array.isArray(p.events)
    ? p.events.filter((e) => ACTIONS.includes(e?.action) && STREETS.includes(e?.street)).slice(-28).map((e) => ({
        street: e.street,
        actorName: text(e.actorName, 64),
        action: e.action,
        amount: finiteOrNull(e.amount),
        confidence: finiteOrNull(e.confidence),
      }))
    : [];

  const opponentStats = p.opponentStats && typeof p.opponentStats === 'object' ? {
    hands: finiteOrNull(p.opponentStats.hands),
    style: text(p.opponentStats.style, 48),
    aggression: finiteOrNull(p.opponentStats.aggression),
    vpipProxy: finiteOrNull(p.opponentStats.vpipProxy),
    bluffPriorAdjustment: finiteOrNull(p.opponentStats.bluffPriorAdjustment),
  } : null;

  const baseline = p.baseline && typeof p.baseline === 'object' ? {
    decision: text(p.baseline.decision, 32),
    reason: text(p.baseline.reason, 280),
    confidence: finiteOrNull(p.baseline.confidence),
    madeHand: text(p.baseline.madeHand, 64),
    boardProfile: p.baseline.boardProfile || null,
    blockers: p.baseline.blockers || null,
    math: p.baseline.math || null,
    opponent: p.baseline.opponent || null,
    rangeMix: p.baseline.rangeMix || null,
  } : null;

  return {
    value: {
      mode: 'replay',
      handId: p.handId,
      fingerprint: p.fingerprint,
      street: p.street,
      heroToAct: Boolean(p.heroToAct),
      hero,
      board,
      pot: finiteOrNull(p.pot),
      actions,
      events,
      actorName: text(p.actorName, 64),
      potBefore: finiteOrNull(p.potBefore),
      opponentStats,
      baseline,
    },
  };
}

function responseSchema() {
  const optionSchema = {
    type: 'object', additionalProperties: false,
    properties: {
      action: { type: 'string', enum: DECISIONS },
      score: { type: 'number', minimum: 0, maximum: 100 },
      summary: { type: 'string', maxLength: 240 },
    },
    required: ['action', 'score', 'summary'],
  };
  return {
    type: 'object', additionalProperties: false,
    properties: {
      decision: { type: 'string', enum: DECISIONS },
      confidence: { type: 'number', minimum: 0, maximum: 100 },
      headline: { type: 'string', maxLength: 160 },
      rationale: { type: 'string', maxLength: 520 },
      keyFactors: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', maxLength: 180 } },
      uncertainties: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 180 } },
      opponentRange: {
        type: 'object', additionalProperties: false,
        properties: {
          shape: { type: 'string', enum: ['unknown', 'value-heavy', 'balanced-mixed', 'polarized', 'bluff-heavy'] },
          valueRegion: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 120 } },
          bluffRegion: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 120 } },
          notes: { type: 'string', maxLength: 300 },
        },
        required: ['shape', 'valueRegion', 'bluffRegion', 'notes'],
      },
      alternatives: { type: 'array', minItems: 1, maxItems: 4, items: optionSchema },
      sizing: {
        type: 'object', additionalProperties: false,
        properties: {
          applicable: { type: 'boolean' },
          target: { type: ['number', 'null'] },
          unit: { type: 'string', enum: ['chips', 'pot_fraction', 'unknown'] },
          note: { type: 'string', maxLength: 220 },
        },
        required: ['applicable', 'target', 'unit', 'note'],
      },
      dataQuality: { type: 'number', minimum: 0, maximum: 100 },
    },
    required: ['decision', 'confidence', 'headline', 'rationale', 'keyFactors', 'uncertainties', 'opponentRange', 'alternatives', 'sizing', 'dataQuality'],
  };
}

function allowedDecision(decision, actions) {
  if (decision === 'insufficient') return true;
  return actions.some((a) => a.type === decision);
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

  const sanitized = sanitizePayload(req.body);
  if (sanitized.error) return res.status(400).json({ error: sanitized.error });
  const state = sanitized.value;
  if (!state.heroToAct) return res.status(400).json({ error: 'hero is not to act' });
  if (state.hero.length !== 2) return res.status(422).json({ error: 'hero cards incomplete' });
  if (state.actions.length < 1) return res.status(422).json({ error: 'actions unavailable' });
  if (state.street !== 'preflop' && state.board.length < 3) return res.status(422).json({ error: 'board incomplete' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  const t0 = Date.now();

  const instructions = [
    'You are the decision brain of Poker Replay Coach. This endpoint is ONLY for replay/simulation/post-game study, never live real-money play.',
    'Reason independently from the observed state. Do NOT follow the baseline recommendation automatically; it is a secondary calculator/guardrail and can be wrong.',
    'Think in ranges and competing hypotheses, not exact hidden opponent cards. Hidden cards are never known. Never call a bluff confirmed.',
    'Use only observed or explicitly supplied facts. Do not invent position, stack size, prior actions, population reads, tournament stage, rake, player identity, or sizing history.',
    'Compare every action that is physically available. Consider hand strength, range interaction, board texture, blockers, pot odds, line coherence, sizing, missed/completed draws, and opponent tendencies only when supported by sample size.',
    'When information is missing, lower confidence and name the uncertainty. Choose insufficient only when a responsible decision cannot be made from the observed state.',
    'For preflop, avoid static hand-strength-only logic: distinguish unopened/raised/3-bet contexts only if the reconstructed action timeline actually supports them. If context is missing, say so.',
    'For postflop, distinguish value, bluff-catcher, draw/semi-bluff, thin value, and pure bluff candidates from the actual line. River raises should not be treated as bluffy without strong evidence.',
    'Do not provide private chain-of-thought. Return concise decision rationale and observable key factors only.',
    'The final decision MUST be one of the physically available action types, unless decision=insufficient.',
  ].join('\n');

  try {
    const body = {
      model: 'gpt-5.6-sol',
      reasoning: { effort: 'medium' },
      store: false,
      max_output_tokens: 1500,
      input: [
        { role: 'developer', content: [{ type: 'input_text', text: instructions }] },
        { role: 'user', content: [{ type: 'input_text', text: `Analyze this replay decision state.\n${JSON.stringify(state)}` }] },
      ],
      text: { format: { type: 'json_schema', name: 'poker_replay_coach_decision', strict: true, schema: responseSchema() } },
    };

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || 'coach reasoning failed' });

    let parsed;
    try { parsed = JSON.parse(extractOutputText(j) || '{}'); }
    catch { return res.status(502).json({ error: 'invalid coach json' }); }

    if (!DECISIONS.includes(parsed.decision)) return res.status(422).json({ error: 'invalid coach decision' });
    if (!allowedDecision(parsed.decision, state.actions)) {
      parsed.uncertainties = [...(parsed.uncertainties || []), `Model proposed unavailable action: ${parsed.decision}.`].slice(0, 5);
      parsed.decision = 'insufficient';
      parsed.confidence = Math.min(Number(parsed.confidence) || 0, 25);
      parsed.headline = 'Ação sugerida não está disponível no estado observado';
    }

    return res.status(200).json({
      ...parsed,
      handId: state.handId,
      fingerprint: state.fingerprint,
      engine: 'dynamic-reasoning-v1',
      ms: Date.now() - t0,
    });
  } catch (e) {
    if (e?.name === 'AbortError') return res.status(504).json({ error: 'coach reasoning timeout' });
    return res.status(502).json({ error: 'coach reasoning request failed' });
  } finally {
    clearTimeout(timer);
  }
}

export { sanitizePayload, allowedDecision };

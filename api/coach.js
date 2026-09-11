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
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function avg(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
}

function sanitizeCard(c) {
  if (!c || !'23456789TJQKA'.includes(String(c.rank || '').toUpperCase())) return null;
  const suit = ['clubs', 'diamonds', 'hearts', 'spades'].includes(c.suit) ? c.suit : null;
  return { rank: String(c.rank).toUpperCase(), suit, confidence: finiteOrNull(c.confidence) };
}

function sanitizeTable(table) {
  if (!table || typeof table !== 'object') return null;
  const seats = Array.isArray(table.seats) ? table.seats.slice(0, 10).map((s) => ({
    seatIndex: Number.isInteger(s?.seatIndex) ? s.seatIndex : null,
    actorName: text(s?.actorName, 64),
    stack: finiteOrNull(s?.stack),
    committed: finiteOrNull(s?.committed),
    dealer: Boolean(s?.dealer),
    folded: typeof s?.folded === 'boolean' ? s.folded : null,
    hero: Boolean(s?.hero),
    position: text(s?.position, 24),
    confidence: finiteOrNull(s?.confidence),
  })).filter((s) => s.seatIndex !== null) : [];
  return {
    confidence: finiteOrNull(table.confidence),
    dealerSeat: Number.isInteger(table.dealerSeat) ? table.dealerSeat : null,
    heroSeat: Number.isInteger(table.heroSeat) ? table.heroSeat : null,
    heroPosition: text(table.heroPosition, 24),
    effectiveStack: finiteOrNull(table.effectiveStack),
    seats,
  };
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
        seatLabel: text(e.seatLabel, 32),
        action: e.action,
        amount: finiteOrNull(e.amount),
        confidence: finiteOrNull(e.confidence),
        source: text(e.source, 32),
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
      table: sanitizeTable(p.table),
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

function objectiveDataQuality(state) {
  let score = 0;
  const heroConf = avg((state.hero || []).map((c) => c.confidence));
  score += 25 * (heroConf ?? (state.hero?.length === 2 ? 0.7 : 0));

  if (state.street === 'preflop') score += 20;
  else {
    const expected = state.street === 'flop' ? 3 : state.street === 'turn' ? 4 : 5;
    const boardComplete = Math.min(1, (state.board?.length || 0) / expected);
    const boardConf = avg((state.board || []).map((c) => c.confidence));
    score += 20 * boardComplete * (boardConf ?? 0.7);
  }

  if (Number.isFinite(state.pot) && state.pot > 0) score += 15;

  const meaningful = (state.actions || []).filter((a) => ['call','bet','raise','allin'].includes(a.type));
  const actionBase = state.actions?.length ? 10 : 0;
  const amountQuality = !meaningful.length ? 1 : meaningful.filter((a) => Number.isFinite(a.amount)).length / meaningful.length;
  score += actionBase + 5 * amountQuality;

  const eventConf = avg((state.events || []).map((e) => e.confidence));
  const eventCoverage = Math.min(1, (state.events?.length || 0) / 4);
  score += 15 * eventCoverage * (eventConf ?? 0.65);

  if (state.actorName) score += 5;
  const hands = Number(state.opponentStats?.hands) || 0;
  score += 5 * Math.min(1, hands / 12);

  if (state.table) {
    const tableConf = clamp(Number(state.table.confidence) || 0, 0, 1);
    if (state.table.heroPosition) score += 4 * tableConf;
    if (Number.isFinite(state.table.effectiveStack)) score += 4 * tableConf;
    if ((state.table.seats || []).length >= 2) score += 2 * tableConf;
  }

  return Math.round(clamp(score, 0, 100));
}

function sortedAlternativeScores(result) {
  return (result?.alternatives || [])
    .map((x) => Number(x?.score))
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
}

function shouldVerifyDecision(result, objectiveQuality) {
  if (!result || result.decision === 'insufficient') return false;
  const scores = sortedAlternativeScores(result);
  const gap = scores.length >= 2 ? scores[0] - scores[1] : 100;
  return Number(result.confidence) < 88 || objectiveQuality < 82 || gap < 15 || (result.uncertainties || []).length >= 2;
}

function calibrateConfidence(result, objectiveQuality, verification = null) {
  const raw = clamp(Number(result?.confidence) || 0, 0, 100);
  let cap = Math.min(97, objectiveQuality + 12);
  if (result?.decision === 'insufficient') cap = Math.min(cap, 40);
  if (verification?.performed && verification.agreement === false) cap = Math.min(cap, 72);
  return Math.round(Math.min(raw, cap));
}

function reasoningInstructions() {
  return [
    'You are the decision brain of Poker Replay Coach. This endpoint is ONLY for replay/simulation/post-game study, never live real-money play.',
    'Reason independently from the observed state. Do NOT follow the baseline recommendation automatically; it is a secondary calculator/guardrail and can be wrong.',
    'Think in ranges and competing hypotheses, not exact hidden opponent cards. Hidden cards are never known. Never call a bluff confirmed.',
    'Use only observed or explicitly supplied facts. Do not invent position, stack size, prior actions, population reads, tournament stage, rake, player identity, or sizing history.',
    'When table data is present, treat position, visible stacks, committed chips and dealer/button as observed evidence only at their supplied confidence. Null means unknown; never fill it in.',
    'Compare every action that is physically available. Consider hand strength, range interaction, board texture, blockers, pot odds, effective stack when observed, line coherence, sizing, missed/completed draws, and opponent tendencies only when supported by sample size.',
    'Seek maximum justified confidence, not a high confidence number. Stress-test the preferred action against the strongest plausible alternative before committing.',
    'When information is missing, lower confidence and name the uncertainty. Choose insufficient only when a responsible decision cannot be made from the observed state.',
    'For preflop, avoid static hand-strength-only logic: use position/effective stack only when observed, and distinguish unopened/raised/3-bet contexts only if the reconstructed action timeline supports them.',
    'For postflop, distinguish value, bluff-catcher, draw/semi-bluff, thin value, and pure bluff candidates from the actual line. River raises should not be treated as bluffy without strong evidence.',
    'Do not provide private chain-of-thought. Return concise decision rationale and observable key factors only.',
    'The final decision MUST be one of the physically available action types, unless decision=insufficient.',
  ].join('\n');
}

async function callCoachModel({ key, state, controller, effort = 'medium', auditOf = null }) {
  const audit = auditOf
    ? '\nThis is a verification pass. Act as an adversarial senior poker coach: try to falsify the first recommendation, re-rank every available action, and change the decision if the evidence supports it. Do not preserve the first answer for consistency. First answer to audit:\n' + JSON.stringify(auditOf)
    : '';
  const body = {
    model: 'gpt-5.6-sol',
    reasoning: { effort },
    store: false,
    max_output_tokens: 1500,
    input: [
      { role: 'developer', content: [{ type: 'input_text', text: reasoningInstructions() }] },
      { role: 'user', content: [{ type: 'input_text', text: `Analyze this replay decision state.${audit}\n${JSON.stringify(state)}` }] },
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
  if (!r.ok) return { error: j?.error?.message || 'coach reasoning failed', status: r.status };
  try { return { value: JSON.parse(extractOutputText(j) || '{}') }; }
  catch { return { error: 'invalid coach json', status: 502 }; }
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
  const timer = setTimeout(() => controller.abort(), 11000);
  const t0 = Date.now();

  try {
    const quality = objectiveDataQuality(state);
    const first = await callCoachModel({ key, state, controller, effort: 'medium' });
    if (first.error) return res.status(first.status || 502).json({ error: first.error });
    let parsed = first.value;
    if (!DECISIONS.includes(parsed.decision)) return res.status(422).json({ error: 'invalid coach decision' });

    let verification = { performed: false, agreement: null, firstDecision: parsed.decision };
    if (shouldVerifyDecision(parsed, quality)) {
      const second = await callCoachModel({ key, state, controller, effort: 'high', auditOf: parsed });
      if (!second.error && DECISIONS.includes(second.value?.decision)) {
        verification = {
          performed: true,
          agreement: second.value.decision === parsed.decision,
          firstDecision: parsed.decision,
        };
        parsed = second.value;
      } else {
        verification = { performed: true, agreement: null, firstDecision: parsed.decision };
      }
    }

    if (!allowedDecision(parsed.decision, state.actions)) {
      parsed.uncertainties = [...(parsed.uncertainties || []), `Model proposed unavailable action: ${parsed.decision}.`].slice(0, 5);
      parsed.decision = 'insufficient';
      parsed.confidence = Math.min(Number(parsed.confidence) || 0, 25);
      parsed.headline = 'Ação sugerida não está disponível no estado observado';
    }

    const modelDataQuality = Number(parsed.dataQuality) || 0;
    parsed.dataQuality = quality;
    parsed.confidence = calibrateConfidence(parsed, quality, verification);

    return res.status(200).json({
      ...parsed,
      modelDataQuality,
      verification,
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

export { sanitizePayload, allowedDecision, objectiveDataQuality, shouldVerifyDecision, calibrateConfidence };
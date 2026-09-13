const ACTIONS = ['fold','check','call','bet','raise','allin'];
const STREETS = ['preflop','flop','turn','river'];
const SOURCE_KINDS = ['video-file','image-file'];

function extractOutputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  for (const item of response?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return '';
}

function sameOrigin(req) {
  const origin = req.headers?.origin;
  const host = req.headers?.host;
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

function card(c) {
  const rank = String(c?.rank || '').toUpperCase();
  const suit = c?.suit;
  if (!'23456789TJQKA'.includes(rank)) return null;
  if (!['clubs','diamonds','hearts','spades'].includes(suit)) return null;
  return { rank, suit };
}

function cleanState(body) {
  if (body?.mode !== 'replay-file-review') return { error: 'replay-file-review mode required' };
  if (body?.paused !== true) return { error: 'paused replay required' };
  if (!SOURCE_KINDS.includes(body?.sourceKind)) return { error: 'uploaded replay source required' };
  if (!Number.isInteger(body?.handId) || body.handId < 1) return { error: 'invalid handId' };
  if (!STREETS.includes(body?.street)) return { error: 'invalid street' };

  const hero = Array.isArray(body.hero) ? body.hero.map(card).filter(Boolean).slice(0, 2) : [];
  const board = Array.isArray(body.board) ? body.board.map(card).filter(Boolean).slice(0, 5) : [];
  const expected = body.street === 'preflop' ? 0 : body.street === 'flop' ? 3 : body.street === 'turn' ? 4 : 5;
  if (hero.length !== 2) return { error: 'manual hero cards incomplete' };
  if (board.length !== expected) return { error: 'board/street mismatch' };

  const actions = Array.isArray(body.actions)
    ? body.actions.filter((a) => ACTIONS.includes(a?.type)).slice(0, 8).map((a) => ({
        type: a.type,
        amount: Number.isFinite(a?.amount) ? a.amount : null,
      }))
    : [];
  if (!actions.length) return { error: 'actions unavailable' };

  const events = Array.isArray(body.events)
    ? body.events.filter((e) => STREETS.includes(e?.street) && ACTIONS.includes(e?.action)).slice(-36).map((e) => ({
        street: e.street,
        actorName: typeof e.actorName === 'string' ? e.actorName.slice(0, 64) : null,
        seatLabel: typeof e.seatLabel === 'string' ? e.seatLabel.slice(0, 32) : null,
        action: e.action,
        amount: Number.isFinite(e.amount) ? e.amount : null,
        confidence: Number.isFinite(e.confidence) ? Math.max(0, Math.min(1, e.confidence)) : null,
      }))
    : [];

  const table = body.table && typeof body.table === 'object' ? {
    heroPosition: typeof body.table.heroPosition === 'string' ? body.table.heroPosition.slice(0, 24) : null,
    effectiveStack: Number.isFinite(body.table.effectiveStack) ? body.table.effectiveStack : null,
    confidence: Number.isFinite(body.table.confidence) ? Math.max(0, Math.min(1, body.table.confidence)) : null,
    seats: Array.isArray(body.table.seats) ? body.table.seats.slice(0, 10).map((s) => ({
      seatIndex: Number.isInteger(s?.seatIndex) ? s.seatIndex : null,
      actorName: typeof s?.actorName === 'string' ? s.actorName.slice(0, 64) : null,
      position: typeof s?.position === 'string' ? s.position.slice(0, 24) : null,
      stack: Number.isFinite(s?.stack) ? s.stack : null,
      committed: Number.isFinite(s?.committed) ? s.committed : null,
      dealer: Boolean(s?.dealer),
      folded: typeof s?.folded === 'boolean' ? s.folded : null,
      hero: Boolean(s?.hero),
      confidence: Number.isFinite(s?.confidence) ? Math.max(0, Math.min(1, s.confidence)) : null,
    })).filter((s) => s.seatIndex !== null) : [],
  } : null;

  const baseline = body.baseline && typeof body.baseline === 'object' ? {
    decision: typeof body.baseline.decision === 'string' ? body.baseline.decision.slice(0, 32) : null,
    reason: typeof body.baseline.reason === 'string' ? body.baseline.reason.slice(0, 400) : null,
    confidence: Number.isFinite(body.baseline.confidence) ? body.baseline.confidence : null,
    source: typeof body.baseline.source === 'string' ? body.baseline.source.slice(0, 64) : null,
  } : null;

  return { value: {
    mode: 'replay-file-review',
    handId: body.handId,
    fingerprint: typeof body.fingerprint === 'string' ? body.fingerprint.slice(0, 512) : null,
    sourceKind: body.sourceKind,
    street: body.street,
    hero,
    board,
    pot: Number.isFinite(body.pot) ? body.pot : null,
    actions,
    events,
    table,
    baseline,
  }};
}

function schema() {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      decision: { type: 'string', enum: [...ACTIONS, 'insufficient'] },
      confidence: { type: 'number', minimum: 0, maximum: 100 },
      reason: { type: 'string', maxLength: 600 },
      details: { type: 'string', maxLength: 900 },
      keyFactors: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', maxLength: 220 } },
      uncertainties: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 220 } },
    },
    required: ['decision','confidence','reason','details','keyFactors','uncertainties'],
  };
}

function instructions() {
  return [
    'Você é o coach sênior do Poker Replay Coach para ESTUDO PÓS-JOGO de replay gravado.',
    'O estado vem de um arquivo de vídeo/imagem já carregado e pausado. Nunca trate isto como assistência para jogo ao vivo.',
    'As duas cartas do Hero foram informadas manualmente pelo usuário e são verdade do estado.',
    'Use somente fatos observados: posição, board, pote, stacks, commitments e histórico de ações fornecidos.',
    'Nunca invente cartas ocultas do oponente. Trabalhe com ranges e hipóteses plausíveis.',
    'Compare todas as ações fisicamente disponíveis. Considere posição, sizing, pot odds, força relativa, textura, blockers, linha anterior e stack efetivo quando conhecido.',
    'O baseline local é apenas uma hipótese; discorde dele quando a evidência justificar.',
    'Se faltar um dado crítico, retorne insufficient e diga exatamente o que falta.',
    'Responda em português do Brasil, de forma didática e objetiva. Não forneça cadeia privada de raciocínio.',
  ].join('\n');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'same-origin replay review required' });
  const site = String(req.headers?.['sec-fetch-site'] || '').toLowerCase();
  if (site && !['same-origin','same-site'].includes(site)) return res.status(403).json({ error: 'cross-site review blocked' });

  const key = process.env.OPENAI_API_KEY || process.env.CHATGPT;
  if (!key) return res.status(501).json({ error: 'OPENAI_API_KEY not configured' });

  const cleaned = cleanState(req.body);
  if (cleaned.error) return res.status(400).json({ error: cleaned.error });
  const state = cleaned.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14000);
  const t0 = Date.now();
  try {
    const body = {
      model: 'gpt-5.6-sol',
      reasoning: { effort: 'high' },
      store: false,
      max_output_tokens: 1400,
      input: [
        { role: 'developer', content: [{ type: 'input_text', text: instructions() }] },
        { role: 'user', content: [{ type: 'input_text', text: `Analise este ponto do replay pausado:\n${JSON.stringify(state)}` }] },
      ],
      text: { format: { type: 'json_schema', name: 'poker_replay_review_r14', strict: true, schema: schema() } },
    };

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || 'coach review failed' });

    let out;
    try { out = JSON.parse(extractOutputText(j) || '{}'); }
    catch { return res.status(502).json({ error: 'invalid coach review json' }); }

    const available = new Set(state.actions.map((a) => a.type));
    if (out.decision !== 'insufficient' && !available.has(out.decision)) {
      out.decision = 'insufficient';
      out.confidence = Math.min(Number(out.confidence) || 0, 25);
      out.uncertainties = [...(out.uncertainties || []), 'A ação sugerida não aparece entre as ações disponíveis no replay.'].slice(0, 5);
      out.reason = 'A IA não conseguiu validar uma ação fisicamente disponível neste ponto do replay.';
    }

    return res.status(200).json({
      ...out,
      handId: state.handId,
      fingerprint: state.fingerprint,
      model: 'gpt-5.6-sol',
      reviewMode: 'paused-uploaded-replay',
      ms: Date.now() - t0,
    });
  } catch (e) {
    if (e?.name === 'AbortError') return res.status(504).json({ error: 'coach review timeout' });
    return res.status(502).json({ error: 'coach review request failed' });
  } finally {
    clearTimeout(timer);
  }
}

export { cleanState };

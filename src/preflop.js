const RANKS = '23456789TJQKA';
const CATEGORY_ORDER = ['fold', 'marginal', 'speculative', 'playable', 'strong', 'premium'];

const GROUPS = {
  premium: new Set(['AA', 'KK', 'QQ', 'AKs', 'AKo']),
  strong: new Set(['JJ', 'TT', 'AQs', 'AQo', 'AJs', 'KQs']),
  playable: new Set(['99', '88', '77', 'ATs', 'AJo', 'KJs', 'KQo', 'QJs', 'JTs', 'T9s', '98s', '87s', 'A9s', 'A8s']),
  speculative: new Set(['66', '55', '44', '33', '22', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s', 'KTs', 'QTs', 'J9s', 'T8s', '97s', '86s', '76s', '65s', '54s']),
  marginal: new Set(['ATo', 'A9o', 'KJo', 'KTo', 'QJo', 'QTo', 'JTo', 'J9o', 'K9s', 'K8s', 'Q9s', 'J8s', 'T7s', '96s', '75s', '64s', '53s', '43s']),
};

const LABELS = {
  premium: 'premium',
  strong: 'forte',
  playable: 'jogável',
  speculative: 'especulativa',
  marginal: 'marginal',
  fold: 'fraca',
};

function rankValue(rank) {
  return RANKS.indexOf(String(rank || '').toUpperCase());
}

function exactCategory(key) {
  for (const name of ['premium', 'strong', 'playable', 'speculative', 'marginal']) {
    if (GROUPS[name].has(key)) return name;
  }
  return 'fold';
}

export function preflopHandKey(cards) {
  if (!Array.isArray(cards) || cards.length !== 2) return null;
  const a = String(cards[0]?.rank || '').toUpperCase();
  const b = String(cards[1]?.rank || '').toUpperCase();
  if (rankValue(a) < 0 || rankValue(b) < 0) return null;
  if (a === b) return `${a}${b}`;
  const hi = rankValue(a) > rankValue(b) ? a : b;
  const lo = hi === a ? b : a;
  const suitedKnown = !!cards[0]?.suit && !!cards[1]?.suit;
  const suffix = suitedKnown ? (cards[0].suit === cards[1].suit ? 's' : 'o') : '?';
  return `${hi}${lo}${suffix}`;
}

export function classifyPreflopHand(cards) {
  const key = preflopHandKey(cards);
  if (!key) return null;
  if (key.length === 2) {
    const category = exactCategory(key);
    return { key, category, label: LABELS[category], suitedKnown: !!cards[0]?.suit && !!cards[1]?.suit, suitRelevant: false };
  }
  if (!key.endsWith('?')) {
    const category = exactCategory(key);
    return { key, category, label: LABELS[category], suitedKnown: true, suitRelevant: true };
  }
  const base = key.slice(0, 2);
  const suitedCategory = exactCategory(`${base}s`);
  const offsuitCategory = exactCategory(`${base}o`);
  const category = CATEGORY_ORDER[Math.min(CATEGORY_ORDER.indexOf(suitedCategory), CATEGORY_ORDER.indexOf(offsuitCategory))];
  return { key, category, label: LABELS[category], suitedKnown: false, suitRelevant: true, suitedCategory, offsuitCategory };
}

const find = (actions, type) => actions.find((a) => a.type === type);
const has = (actions, type) => !!find(actions, type);
const result = (decision, reason, confidence, details) => ({ decision, reason, confidence, details });

export function recommendPreflop(state) {
  const profile = classifyPreflopHand(state.hero);
  if (!profile) return { decision: null, reason: 'Força pré-flop ainda não confiável.', confidence: 0, details: [] };

  const actions = Array.isArray(state.actions) ? state.actions : [];
  const call = find(actions, 'call')?.amount ?? null;
  const pot = Number.isFinite(state.pot) ? state.pot : null;
  const potOdds = call && pot ? call / (pot + call) : null;
  const freeOption = has(actions, 'check');
  const suitDetail = !profile.suitRelevant
    ? 'Par de mão; o naipe não altera a classe pré-flop.'
    : profile.suitedKnown
      ? 'Naipe confirmado.'
      : 'Naipe ainda não confirmado; classificação conservadora.';
  const details = [
    `Mão pré-flop: ${profile.key} · ${profile.label}.`,
    suitDetail,
    'Sem posição, stack efetivo e linha completa: confiança limitada.',
  ];
  if (potOdds !== null) details.push(`Preço do call: ~${Math.round(potOdds * 100)}% do pote final.`);

  if (freeOption) {
    if (['premium', 'strong'].includes(profile.category) && has(actions, 'raise'))
      return result('AUMENTAR', 'Mão forte com opção gratuita disponível: tomar iniciativa é razoável.', 72, details);
    return result('PASSAR', 'Sem custo adicional e sem contexto suficiente para ampliar o pote.', 76, details);
  }

  if (profile.category === 'premium') {
    if (has(actions, 'raise')) return result('AUMENTAR', 'Faixa premium: priorizar valor e iniciativa.', 86, details);
    if (has(actions, 'call')) return result('PAGAR', 'Faixa premium, mas o raise não está disponível na leitura atual.', 72, details);
  }

  if (profile.category === 'strong') {
    if (has(actions, 'call') && call === null) return { decision: null, reason: 'Lendo o valor do call…', confidence: 0, details };
    if (has(actions, 'call')) return result('PAGAR', 'Mão forte o bastante para continuar enquanto posição e sequência anterior ainda são desconhecidas.', 64, details);
  }

  if (profile.category === 'playable') {
    if (has(actions, 'call') && call === null) return { decision: null, reason: 'Lendo o valor do call…', confidence: 0, details };
    if (has(actions, 'call') && potOdds !== null && potOdds <= 0.22)
      return result('PAGAR', 'Mão jogável e preço moderado; continuar de forma conservadora.', 58, details);
    if (has(actions, 'fold')) return result('DESISTIR', 'Mão dependente de posição/sizing; sem esse contexto, evitar um call caro.', 66, details);
  }

  if (profile.category === 'speculative') {
    if (has(actions, 'call') && call === null) return { decision: null, reason: 'Lendo o valor do call…', confidence: 0, details };
    if (has(actions, 'call') && potOdds !== null && potOdds <= 0.15)
      return result('PAGAR', 'Mão especulativa com preço muito baixo; continuar pode ser justificável.', 54, details);
    if (has(actions, 'fold')) return result('DESISTIR', 'Mão especulativa sem preço/contexto suficiente para investir.', 70, details);
  }

  if (has(actions, 'fold')) {
    const reason = profile.category === 'marginal'
      ? 'Mão marginal e contexto incompleto: preservar fichas é a linha mais segura.'
      : 'Mão pré-flop fraca para investir sem vantagem contextual clara.';
    return result('DESISTIR', reason, profile.category === 'fold' ? 82 : 74, details);
  }

  if (has(actions, 'call')) return result('PAGAR', 'Não há fold disponível na leitura; continuar é a única linha conservadora compatível.', 45, details);
  return { decision: null, reason: 'Nenhuma ação pré-flop compatível foi lida.', confidence: 0, details };
}

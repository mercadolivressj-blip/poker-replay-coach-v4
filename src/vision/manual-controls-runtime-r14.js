const diagnostics = {
  opens: 0,
  applies: 0,
  rejected: 0,
  lastAppliedAt: null,
  lastTarget: null,
};
if (typeof window !== 'undefined') window.__prcManualControlsR14 = diagnostics;

const SUITS = Object.freeze({
  s: 'spades', '♠': 'spades',
  h: 'hearts', '♥': 'hearts',
  d: 'diamonds', '♦': 'diamonds',
  c: 'clubs', '♣': 'clubs',
});
const RANKS = Object.freeze(['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']);
const SUIT_META = Object.freeze([
  { id: 'spades', symbol: '♠', label: 'Espadas' },
  { id: 'hearts', symbol: '♥', label: 'Copas' },
  { id: 'diamonds', symbol: '♦', label: 'Ouros' },
  { id: 'clubs', symbol: '♣', label: 'Paus' },
]);
const SUIT_SYMBOL = Object.freeze(Object.fromEntries(SUIT_META.map((s) => [s.id, s.symbol])));

const working = {
  target: null,
  hero: [],
  board: [],
  boardCount: 0,
  pot: null,
  activeSlot: 0,
};

function parseCards(raw, allowedCounts) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const cards = [];
  const re = /(10|[2-9TJQKA])\s*(♠|♥|♦|♣|[SHDC])/gi;
  let match;
  while ((match = re.exec(text))) {
    const rank = match[1].toUpperCase() === '10' ? 'T' : match[1].toUpperCase();
    const suit = SUITS[match[2].toLowerCase?.() || match[2]] || SUITS[match[2]];
    cards.push({ rank, suit, confidence: 1, suitConfidence: 1, source: 'manual-r14' });
  }
  if (!allowedCounts.includes(cards.length)) return null;
  return cards;
}

function parsePot(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const cleaned = text.replace(/US\$/gi, '').replace(/\s/g, '').replace(',', '.').replace(/[^0-9.]/g, '');
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : NaN;
}

function emptyCard() {
  return { rank: null, suit: null, confidence: 1, suitConfidence: 1, source: 'manual-r14' };
}

function normalizeCards(cards, count) {
  return Array.from({ length: count }, (_, i) => ({ ...emptyCard(), ...(cards?.[i] || {}) }));
}

function completeCard(card) {
  return Boolean(card?.rank && card?.suit);
}

function cardLabel(card) {
  if (!card?.rank && !card?.suit) return '—';
  return `${card?.rank || '?'}${SUIT_SYMBOL[card?.suit] || '?'}`;
}

function cardsLabel(cards) {
  return (cards || []).map(cardLabel).join(' ') || '—';
}

function currentSnapshot() {
  try {
    const snapshot = window.__prcDealArbiterR14?.view?.();
    if (snapshot) return snapshot;
  } catch {}
  return { hero: [], board: [], pot: null, street: 'preflop' };
}

function setMessage(text, kind = '') {
  const el = document.getElementById('manualMessage');
  if (!el) return;
  el.textContent = text || '';
  el.dataset.kind = kind;
}

function targetCopy(target) {
  if (target === 'hero') return {
    title: 'Corrigir suas cartas',
    help: 'Clique em Carta 1 ou Carta 2 e escolha o valor e o naipe. Não precisa digitar nada.',
  };
  if (target === 'board') return {
    title: 'Corrigir o board',
    help: 'Escolha quantas cartas estão na mesa e depois selecione valor e naipe de cada uma.',
  };
  return {
    title: 'Corrigir o pote',
    help: 'Informe somente o valor atual do pote. Ex.: 0,07.',
  };
}

function renderCurrentState(snapshot) {
  const current = document.getElementById('manualCurrentState');
  if (!current) return;
  if (working.target === 'hero') current.textContent = `Atual: ${cardsLabel(snapshot.hero)}`;
  else if (working.target === 'board') current.textContent = `Atual: ${cardsLabel(snapshot.board)}`;
  else current.textContent = `Atual: ${Number.isFinite(snapshot.pot) ? String(snapshot.pot).replace('.', ',') : '—'}`;
}

function renderBoardCount() {
  const wrap = document.getElementById('manualBoardLength');
  if (!wrap) return;
  wrap.querySelectorAll('[data-board-count]').forEach((button) => {
    button.classList.toggle('selected', Number(button.dataset.boardCount) === working.boardCount);
  });
}

function activeCardsAndCount() {
  if (working.target === 'hero') return { cards: working.hero, count: 2 };
  if (working.target === 'board') return { cards: working.board, count: working.boardCount };
  return { cards: [], count: 0 };
}

function renderCardEditor() {
  const editor = document.getElementById('manualCardsEditor');
  const slotsEl = document.getElementById('manualCardSlots');
  const rankEl = document.getElementById('manualRankGrid');
  const suitEl = document.getElementById('manualSuitGrid');
  if (!editor || !slotsEl || !rankEl || !suitEl) return;

  const { cards, count } = activeCardsAndCount();
  if (!count) {
    editor.classList.add('hidden');
    return;
  }
  editor.classList.remove('hidden');
  working.activeSlot = Math.max(0, Math.min(working.activeSlot, count - 1));
  const active = cards[working.activeSlot] || emptyCard();

  slotsEl.replaceChildren();
  for (let i = 0; i < count; i++) {
    const card = cards[i] || emptyCard();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'manual-card-slot';
    if (i === working.activeSlot) button.classList.add('active');
    if (card.suit === 'hearts' || card.suit === 'diamonds') button.classList.add('red');
    button.dataset.cardIndex = String(i);
    const strong = document.createElement('strong');
    strong.textContent = cardLabel(card);
    const small = document.createElement('small');
    small.textContent = working.target === 'hero' ? `Carta ${i + 1}` : `Board ${i + 1}`;
    button.append(strong, small);
    slotsEl.append(button);
  }

  rankEl.replaceChildren();
  for (const rank of RANKS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.rank = rank;
    button.textContent = rank === 'T' ? '10' : rank;
    if (active.rank === rank) button.classList.add('selected');
    rankEl.append(button);
  }

  suitEl.replaceChildren();
  for (const suit of SUIT_META) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.suit = suit.id;
    if (active.suit === suit.id) button.classList.add('selected');
    const symbol = document.createElement('b');
    symbol.textContent = suit.symbol;
    const label = document.createElement('span');
    label.textContent = suit.label;
    button.append(symbol, label);
    suitEl.append(button);
  }
}

function selectCardPart(kind, value) {
  const { cards, count } = activeCardsAndCount();
  if (!count || !cards[working.activeSlot]) return;
  cards[working.activeSlot][kind] = value;
  cards[working.activeSlot].confidence = 1;
  cards[working.activeSlot].suitConfidence = 1;
  cards[working.activeSlot].source = 'manual-r14';

  if (completeCard(cards[working.activeSlot])) {
    const next = cards.findIndex((card, index) => index > working.activeSlot && index < count && !completeCard(card));
    if (next >= 0) working.activeSlot = next;
  }
  renderCardEditor();
  setMessage('Seleção pronta para aplicar.');
}

function setBoardCount(count) {
  if (![0, 3, 4, 5].includes(count)) return;
  working.boardCount = count;
  working.activeSlot = 0;
  renderBoardCount();
  renderCardEditor();
  setMessage(count === 0 ? 'Board será corrigido para preflop / vazio.' : `Selecione as ${count} cartas do board.`);
}

function openPanel(target) {
  if (!['hero', 'board', 'pot'].includes(target)) return;
  const panel = document.getElementById('manualPanel');
  if (!panel) return;

  diagnostics.opens++;
  diagnostics.lastTarget = target;
  working.target = target;
  working.activeSlot = 0;
  const snapshot = currentSnapshot();
  working.hero = normalizeCards(snapshot.hero, 2);
  working.board = normalizeCards(snapshot.board, 5);
  working.boardCount = [0, 3, 4, 5].includes(snapshot.board?.length) ? snapshot.board.length : 0;
  working.pot = Number.isFinite(snapshot.pot) ? snapshot.pot : null;

  const copy = targetCopy(target);
  const title = document.getElementById('manualTitle');
  const help = document.getElementById('manualHelp');
  if (title) title.textContent = copy.title;
  if (help) help.textContent = copy.help;
  renderCurrentState(snapshot);

  document.getElementById('manualBoardLength')?.classList.toggle('hidden', target !== 'board');
  document.getElementById('manualPotEditor')?.classList.toggle('hidden', target !== 'pot');
  if (target === 'hero' || (target === 'board' && working.boardCount > 0)) renderCardEditor();
  else document.getElementById('manualCardsEditor')?.classList.add('hidden');
  renderBoardCount();

  const potInput = document.getElementById('manualPotInput');
  if (potInput) potInput.value = target === 'pot' && working.pot !== null ? String(working.pot).replace('.', ',') : '';

  setMessage(target === 'pot' ? 'Digite o valor e aplique.' : 'Clique em uma carta para editar.');
  panel.classList.remove('hidden');
  if (target === 'pot') setTimeout(() => potInput?.focus(), 0);
}

function closePanel() {
  document.getElementById('manualPanel')?.classList.add('hidden');
  working.target = null;
}

function duplicateCard(cards) {
  const seen = new Set();
  for (const card of cards.filter(completeCard)) {
    const key = `${card.rank}:${card.suit}`;
    if (seen.has(key)) return card;
    seen.add(key);
  }
  return null;
}

function applyManual() {
  const apply = window.__prcApplyManualReplayStateR14;
  if (typeof apply !== 'function') {
    diagnostics.rejected++;
    setMessage('Controle manual ainda não está disponível neste carregamento.', 'error');
    return;
  }

  const snapshot = currentSnapshot();
  let payload;
  if (working.target === 'hero') {
    const hero = working.hero.slice(0, 2);
    if (hero.length !== 2 || !hero.every(completeCard)) {
      diagnostics.rejected++;
      setMessage('Escolha valor e naipe das duas cartas.', 'error');
      return;
    }
    const duplicate = duplicateCard([...hero, ...(snapshot.board || [])]);
    if (duplicate) {
      diagnostics.rejected++;
      setMessage(`Carta duplicada: ${cardLabel(duplicate)}.`, 'error');
      return;
    }
    payload = { hero };
  } else if (working.target === 'board') {
    const board = working.boardCount === 0 ? [] : working.board.slice(0, working.boardCount);
    if (working.boardCount > 0 && !board.every(completeCard)) {
      diagnostics.rejected++;
      setMessage(`Escolha valor e naipe das ${working.boardCount} cartas.`, 'error');
      return;
    }
    const duplicate = duplicateCard([...(snapshot.hero || []), ...board]);
    if (duplicate) {
      diagnostics.rejected++;
      setMessage(`Carta duplicada: ${cardLabel(duplicate)}.`, 'error');
      return;
    }
    payload = { board };
  } else if (working.target === 'pot') {
    const pot = parsePot(document.getElementById('manualPotInput')?.value || '');
    if (!Number.isFinite(pot)) {
      diagnostics.rejected++;
      setMessage('Informe um valor de pote válido. Ex.: 0,07.', 'error');
      return;
    }
    payload = { pot };
  } else {
    diagnostics.rejected++;
    return;
  }

  const result = apply(payload);
  if (!result?.accepted) {
    diagnostics.rejected++;
    setMessage('A correção manual foi recusada pelo estado atual.', 'error');
    return;
  }

  diagnostics.applies++;
  diagnostics.lastAppliedAt = Date.now();
  const cardTarget = working.target === 'hero' || working.target === 'board';
  setMessage(cardTarget ? 'Correção aplicada e travada nesta mão.' : 'Pote corrigido para o estado atual.', 'ok');
  setTimeout(closePanel, 550);
}

function install() {
  if (typeof document === 'undefined') return;

  document.querySelectorAll('.metric-editable[data-manual-target]').forEach((metric) => {
    if (metric.__prcManualInstalled) return;
    metric.__prcManualInstalled = true;
    const open = () => openPanel(metric.dataset.manualTarget);
    metric.addEventListener('click', open);
    metric.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });

  document.getElementById('manualCardSlots')?.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-card-index]');
    if (!button) return;
    working.activeSlot = Number(button.dataset.cardIndex) || 0;
    renderCardEditor();
  });
  document.getElementById('manualRankGrid')?.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-rank]');
    if (button) selectCardPart('rank', button.dataset.rank);
  });
  document.getElementById('manualSuitGrid')?.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-suit]');
    if (button) selectCardPart('suit', button.dataset.suit);
  });
  document.getElementById('manualBoardLength')?.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-board-count]');
    if (button) setBoardCount(Number(button.dataset.boardCount));
  });

  document.getElementById('manualCloseBtn')?.addEventListener('click', closePanel);
  document.getElementById('manualCancelBtn')?.addEventListener('click', closePanel);
  document.getElementById('manualApplyBtn')?.addEventListener('click', applyManual);
  document.getElementById('manualPanel')?.addEventListener('click', (event) => {
    if (event.target?.id === 'manualPanel') closePanel();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePanel();
  });
}

install();

export { parseCards, parsePot };

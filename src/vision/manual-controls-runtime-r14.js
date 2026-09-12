const diagnostics = {
  opens: 0,
  applies: 0,
  rejected: 0,
  lastAppliedAt: null,
};
if (typeof window !== 'undefined') window.__prcManualControlsR14 = diagnostics;

const SUITS = Object.freeze({
  s: 'spades', '♠': 'spades',
  h: 'hearts', '♥': 'hearts',
  d: 'diamonds', '♦': 'diamonds',
  c: 'clubs', '♣': 'clubs',
});

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

function setMessage(text, kind = '') {
  const el = document.getElementById('manualMessage');
  if (!el) return;
  el.textContent = text || '';
  el.dataset.kind = kind;
}

function openPanel() {
  const panel = document.getElementById('manualPanel');
  if (!panel) return;
  diagnostics.opens++;
  const heroNow = document.getElementById('heroCards')?.textContent || '—';
  const boardNow = document.getElementById('boardCards')?.textContent || '—';
  const potNow = document.getElementById('potValue')?.textContent || '—';
  const current = document.getElementById('manualCurrentState');
  if (current) current.textContent = `Atual: Hero ${heroNow} · Board ${boardNow} · Pote ${potNow}`;
  setMessage('Preencha somente o que quiser corrigir.');
  panel.classList.remove('hidden');
  document.getElementById('manualHeroInput')?.focus();
}

function closePanel() {
  document.getElementById('manualPanel')?.classList.add('hidden');
}

function applyManual() {
  const heroRaw = document.getElementById('manualHeroInput')?.value?.trim() || '';
  const boardRaw = document.getElementById('manualBoardInput')?.value?.trim() || '';
  const boardEmpty = Boolean(document.getElementById('manualBoardEmpty')?.checked);
  const potRaw = document.getElementById('manualPotInput')?.value?.trim() || '';

  if (!heroRaw && !boardRaw && !boardEmpty && !potRaw) {
    diagnostics.rejected++;
    setMessage('Informe pelo menos uma correção.', 'error');
    return;
  }

  const hero = heroRaw ? parseCards(heroRaw, [2]) : undefined;
  if (heroRaw && !hero) {
    diagnostics.rejected++;
    setMessage('Hero inválido. Use, por exemplo: J♥ 2♦ ou Jh 2d.', 'error');
    return;
  }

  let board;
  if (boardEmpty) board = [];
  else if (boardRaw) board = parseCards(boardRaw, [3, 4, 5]);
  if (boardRaw && !board) {
    diagnostics.rejected++;
    setMessage('Board inválido. Informe 3, 4 ou 5 cartas, ex.: A♠ 7♥ 3♦.', 'error');
    return;
  }

  const pot = potRaw ? parsePot(potRaw) : undefined;
  if (potRaw && !Number.isFinite(pot)) {
    diagnostics.rejected++;
    setMessage('Pote inválido. Use, por exemplo: 0,07.', 'error');
    return;
  }

  const apply = window.__prcApplyManualReplayStateR14;
  if (typeof apply !== 'function') {
    diagnostics.rejected++;
    setMessage('Controle manual ainda não está disponível neste carregamento.', 'error');
    return;
  }

  const result = apply({ hero, board, pot });
  if (!result?.accepted) {
    diagnostics.rejected++;
    setMessage('A correção manual foi recusada pelo estado atual.', 'error');
    return;
  }

  diagnostics.applies++;
  diagnostics.lastAppliedAt = Date.now();
  setMessage('Correção aplicada e travada nesta mão.', 'ok');
  setTimeout(closePanel, 450);
}

function install() {
  if (typeof document === 'undefined') return;
  const openBtn = document.getElementById('manualBtn');
  if (!openBtn || openBtn.__prcInstalled) return;
  openBtn.__prcInstalled = true;
  openBtn.addEventListener('click', openPanel);
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

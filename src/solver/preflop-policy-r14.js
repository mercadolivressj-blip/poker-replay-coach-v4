import { preflopHandKey } from '../preflop.js';

const RANKS = '23456789TJQKA';
const rv = (r) => RANKS.indexOf(String(r || '').toUpperCase());
const find = (actions, type) => (actions || []).find((a) => a?.type === type) || null;
const has = (actions, type) => Boolean(find(actions, type));

function parseKey(key) {
  if (!key) return null;
  if (key.length === 2) return { pair: true, hi: rv(key[0]), lo: rv(key[1]), suited: false, offsuit: false };
  return {
    pair: false,
    hi: rv(key[0]),
    lo: rv(key[1]),
    suited: key.endsWith('s'),
    offsuit: key.endsWith('o'),
  };
}

function atLeast(rank, min) { return rv(rank) >= rv(min); }
function pairAtLeast(key, min) { return key?.length === 2 && atLeast(key[0], min); }
function isAnyAce(m) { return m && m.hi === rv('A'); }
function isSuitedAce(m) { return isAnyAce(m) && m.suited; }
function isOffAceAtLeast(m, low) { return isAnyAce(m) && m.offsuit && m.lo >= rv(low); }
function isSuitedKingAtLeast(m, low) { return m?.hi === rv('K') && m.suited && m.lo >= rv(low); }
function isOffKingAtLeast(m, low) { return m?.hi === rv('K') && m.offsuit && m.lo >= rv(low); }
function isSuitedQueenAtLeast(m, low) { return m?.hi === rv('Q') && m.suited && m.lo >= rv(low); }
function isOffQueenAtLeast(m, low) { return m?.hi === rv('Q') && m.offsuit && m.lo >= rv(low); }
function isSuitedJackAtLeast(m, low) { return m?.hi === rv('J') && m.suited && m.lo >= rv(low); }
function isOffJackAtLeast(m, low) { return m?.hi === rv('J') && m.offsuit && m.lo >= rv(low); }
function isSuitedTenAtLeast(m, low) { return m?.hi === rv('T') && m.suited && m.lo >= rv(low); }
function isOffTenAtLeast(m, low) { return m?.hi === rv('T') && m.offsuit && m.lo >= rv(low); }

function exact(key, values) { return values.includes(key); }

function openFrom(position, key) {
  const m = parseKey(key);
  if (!m) return false;
  const p = String(position || '').toUpperCase();

  if (p === 'UTG' || p === 'UTG+1' || p === 'UTG+2' || p === 'MP' || p === 'LJ') {
    return pairAtLeast(key, '6')
      || isSuitedAce(m)
      || isOffAceAtLeast(m, 'J')
      || isSuitedKingAtLeast(m, 'T')
      || isOffKingAtLeast(m, 'Q')
      || isSuitedQueenAtLeast(m, 'T')
      || isSuitedJackAtLeast(m, 'T')
      || exact(key, ['T9s','98s']);
  }

  if (p === 'HJ') {
    return pairAtLeast(key, '2')
      || isSuitedAce(m)
      || isOffAceAtLeast(m, 'T')
      || isSuitedKingAtLeast(m, '9')
      || isOffKingAtLeast(m, 'J')
      || isSuitedQueenAtLeast(m, '9')
      || isOffQueenAtLeast(m, 'J')
      || isSuitedJackAtLeast(m, '9')
      || isSuitedTenAtLeast(m, '8')
      || exact(key, ['98s','87s','76s']);
  }

  if (p === 'CO') {
    return pairAtLeast(key, '2')
      || isSuitedAce(m)
      || isOffAceAtLeast(m, '8')
      || isSuitedKingAtLeast(m, '7')
      || isOffKingAtLeast(m, 'T')
      || isSuitedQueenAtLeast(m, '8')
      || isOffQueenAtLeast(m, 'T')
      || isSuitedJackAtLeast(m, '8')
      || isOffJackAtLeast(m, 'T')
      || isSuitedTenAtLeast(m, '8')
      || exact(key, ['97s','98s','87s','86s','76s','75s','65s','54s']);
  }

  if (p === 'BTN') {
    return pairAtLeast(key, '2')
      || isAnyAce(m)
      || isSuitedKingAtLeast(m, '2')
      || isOffKingAtLeast(m, '7')
      || isSuitedQueenAtLeast(m, '5')
      || isOffQueenAtLeast(m, '8')
      || isSuitedJackAtLeast(m, '7')
      || isOffJackAtLeast(m, '8')
      || isSuitedTenAtLeast(m, '6')
      || isOffTenAtLeast(m, '8')
      || exact(key, ['98o','97s','98s','87s','76s','65s','54s','43s']);
  }

  if (p === 'SB' || p === 'BTN/SB') {
    return pairAtLeast(key, '2')
      || isAnyAce(m)
      || isSuitedKingAtLeast(m, '2')
      || isOffKingAtLeast(m, '5')
      || isSuitedQueenAtLeast(m, '5')
      || isOffQueenAtLeast(m, '8')
      || isSuitedJackAtLeast(m, '7')
      || isOffJackAtLeast(m, '8')
      || isSuitedTenAtLeast(m, '7')
      || isOffTenAtLeast(m, '8')
      || exact(key, ['98o','97s','98s','87s','76s','65s','54s']);
  }

  return false;
}

function limpFromSB(position, key) {
  const p = String(position || '').toUpperCase();
  if (p !== 'SB' && p !== 'BTN/SB') return false;
  const m = parseKey(key);
  if (!m) return false;
  if (openFrom(position, key)) return false;
  return (m.suited && m.hi >= rv('6'))
    || exact(key, ['K4o','K3o','K2o','Q7o','Q6o','J7o','T7o','97o','87o','76o']);
}

function fmt(n) {
  if (!Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 0 }).format(v);
}

export function recommendUnopenedPreflop({ hero = [], position = null, actions = [], pot = null, sb = null, bb = null } = {}) {
  const key = preflopHandKey(hero);
  if (!key || !position) return null;

  if (String(position).toUpperCase() === 'BB' && has(actions, 'check')) {
    return {
      decision: 'check',
      confidence: 92,
      reason: `${key} no BB em pote unopened: não há raise para enfrentar; PASSAR preserva o pote sem investir mais.`,
      details: `Pré-flop · BB · blinds ${fmt(sb)}/${fmt(bb)} · pote ${fmt(pot)} · nenhum agressor real.`,
      policy: 'unopened-chart-r14',
    };
  }

  if (openFrom(position, key) && has(actions, 'raise')) {
    const raise = find(actions, 'raise');
    return {
      decision: 'raise',
      confidence: 90,
      reason: `${key} em ${position} está dentro da faixa determinística de open deste Coach. Como o pote está unopened, os blinds são apenas apostas obrigatórias, não agressão. AUMENTAR toma iniciativa e realiza melhor a equity da mão.`,
      details: `Pré-flop · ${position} · unopened · pote ${fmt(pot)}${Number.isFinite(raise?.amount) ? ` · raise disponível ${fmt(raise.amount)}` : ''} · blinds ${fmt(sb)}/${fmt(bb)}.`,
      policy: 'unopened-chart-r14',
    };
  }

  if (limpFromSB(position, key) && has(actions, 'call')) {
    const call = find(actions, 'call');
    return {
      decision: 'call',
      confidence: 82,
      reason: `${key} no ${position} fica fora do open principal, mas entra na faixa de complete/limp deste modelo. PAGAR ${fmt(call?.amount)} mantém a mão no pote sem transformar o big blind em um falso agressor.`,
      details: `Pré-flop · ${position} · unopened · complete/limp · blinds ${fmt(sb)}/${fmt(bb)}.`,
      policy: 'unopened-chart-r14',
    };
  }

  if (has(actions, 'fold')) {
    return {
      decision: 'fold',
      confidence: 88,
      reason: `${key} em ${position} fica abaixo do corte de open determinístico deste Coach para um pote unopened. DESISTIR evita abrir uma mão cuja realização esperada é baixa nesta posição.`,
      details: `Pré-flop · ${position} · unopened · nenhum agressor real · blinds ${fmt(sb)}/${fmt(bb)}.`,
      policy: 'unopened-chart-r14',
    };
  }

  return null;
}

export { openFrom, limpFromSB };

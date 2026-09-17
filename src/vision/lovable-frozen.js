import {
  CARD_RULES,
  SYSTEM_HERO,
  SYSTEM_BOARD,
  SYSTEM_ACTIONS,
  SYSTEM_QUICK,
  SYSTEM_SEAT_TILES,
} from './lovable-frozen-prompts.js';

export { CARD_RULES, SYSTEM_HERO, SYSTEM_BOARD, SYSTEM_ACTIONS, SYSTEM_QUICK, SYSTEM_SEAT_TILES };

export const FROZEN_VISION_REF = 'lovable:3efde306fbb1dda38584cb8ffee0c2245b6231f4';
export const HERO_FAST_LOCK_CONFIDENCE = 0.9;
export const FROZEN_MODELS = Object.freeze({ fast: 'gemini-3.1-flash-lite', fallback: 'gemini-3.8-flash' });
export const FROZEN_CROPS = Object.freeze({
  hero: Object.freeze({ x: 0.36, y: 0.52, w: 0.28, h: 0.24, quality: 0.82, maxScale: 1.6, targetWidth: 1280 }),
  board: Object.freeze({ x: 0.26, y: 0.30, w: 0.48, h: 0.16, quality: 0.82, maxScale: 1.6, targetWidth: 1280 }),
  actions: Object.freeze({ x: 0.38, y: 0.55, w: 0.61, h: 0.44, quality: 0.76, maxScale: 1.5, targetWidth: 1280 }),
});

const CARD = /^[2-9TJQKA][hdcs]$/;
const RANKS = new Set(['2','3','4','5','6','7','8','9','T','J','Q','K','A']);
const SUIT_SHORT = { hearts:'h', diamonds:'d', clubs:'c', spades:'s', h:'h', d:'d', c:'c', s:'s' };
const SUIT_LONG = { h:'hearts', d:'diamonds', c:'clubs', s:'spades' };

export const isLegalCard = (v) => typeof v === 'string' && CARD.test(v);
export const cardKey = (cards = []) => [...cards].sort().join('|');
export const rankKey = (cards = []) => [...cards].map((c)=>c?.[0] || '').sort().join('|');

export function parseJsonText(raw) {
  const text = String(raw ?? '').replace(/^\s*```(?:json)?/i,'').replace(/```\s*$/,'').trim();
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try { return JSON.parse(m[0]); } catch { return {}; }
}

function cleanCardStrings(values) {
  if (!Array.isArray(values)) return [];
  const out=[];
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const c=v.trim();
    if (!isLegalCard(c) || out.includes(c)) continue;
    out.push(c);
  }
  return out;
}

export function normalizeLovableVision(kind, rawText) {
  const p = typeof rawText === 'string' ? parseJsonText(rawText) : (rawText || {});
  const confidence = typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0;
  if (kind === 'hero') {
    const heroCards = cleanCardStrings(p.heroCards).slice(0,2);
    const heroPresence = heroCards.length === 2 ? 'present' : ['present','absent','uncertain'].includes(p.heroPresence) ? p.heroPresence : 'uncertain';
    return { heroCards, heroPresence, confidence };
  }
  if (kind === 'board') {
    const board = cleanCardStrings(p.board).slice(0,5);
    const legalCount = [0,3,4,5].includes(board.length);
    const boardPresence = board.length >= 3 ? 'present' : p.boardPresence === 'absent' && board.length === 0 ? 'absent' : 'uncertain';
    return { board: legalCount ? board : [], boardPresence: legalCount ? boardPresence : 'uncertain', confidence };
  }
  if (kind === 'actions') {
    const valid = new Set(['FOLD','CHECK','CALL','BET','RAISE','ALLIN']);
    const legalActions = Array.isArray(p.legalActions) ? [...new Set(p.legalActions.map((x)=>String(x).toUpperCase()).filter((x)=>valid.has(x)))].slice(0,6) : [];
    return { legalActions, toCall: typeof p.toCall === 'string' && p.toCall.trim() ? p.toCall.trim() : null, confidence };
  }
  if (kind === 'quick') {
    const str = (v) => typeof v === 'string' && v.trim() ? v.trim() : null;
    return { pot:str(p.pot), heroStack:str(p.heroStack), blinds:str(p.blinds), confidence };
  }
  if (kind === 'seat_tiles') {
    const bool=(v)=>v===true?true:v===false?false:null;
    const str=(v)=>typeof v==='string'&&v.trim()?v.trim():null;
    const post=(v)=>v==='SB'?'SB':v==='BB'?'BB':null;
    const tiles=(Array.isArray(p.tiles)?p.tiles:[]).slice(0,6).map((e)=>({
      index: typeof e?.i==='number'?e.i:Number(e?.i)||0,
      action:str(e?.action), amount:str(e?.amount), occupied:bool(e?.occupied), isDealer:bool(e?.isDealer), blindPost:post(e?.blindPost),
    })).filter((t)=>t.index>=1&&t.index<=6);
    return { tiles, confidence };
  }
  return { confidence };
}

export const heroReadConclusive = (r) => r?.heroPresence === 'present' && Array.isArray(r.heroCards) && r.heroCards.length === 2 && r.heroCards.every(isLegalCard) && new Set(r.heroCards).size === 2;
export const boardReadConclusive = (r) => {
  if (!Array.isArray(r?.board) || !r.board.every(isLegalCard) || new Set(r.board).size !== r.board.length) return false;
  return (r.boardPresence === 'present' && [3,4,5].includes(r.board.length)) || (r.boardPresence === 'absent' && r.board.length === 0);
};

export function toLegacyCards(kind, normalized) {
  const values = kind === 'hero' ? normalized.heroCards : kind === 'board' ? normalized.board : [];
  return values.map((c) => ({ rank:c[0], suit:SUIT_LONG[c[1]] ?? null, confidence:normalized.confidence }));
}

export function legacyCardToShort(card) {
  if (!card || !RANKS.has(card.rank)) return null;
  const suit = SUIT_SHORT[card.suit];
  return suit ? `${card.rank}${suit}` : null;
}

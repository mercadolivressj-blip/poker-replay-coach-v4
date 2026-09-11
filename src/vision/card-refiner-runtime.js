import { activeHandMachine } from '../core/state-machine.js';
import { detectFelt, layoutFromFelt, stabilizeFelt } from '../core/geometry.js';
import { cropCanvas } from '../core/image.js';
import { classifyRankPixels } from '../core/rank-classifier.js';
import { classifySuitPixels } from '../core/suit-classifier.js';
import { HeroCardConsensus } from '../core/hero-card-consensus.js';
import { BoardCardConsensus } from '../core/board-card-consensus.js';
import { SuitConsensus } from '../core/suit-consensus.js';
import { OcrService } from '../core/ocr.js';
import { cardPresenceScore, boardCountFromScores, rankCrop } from '../detectors/cards.js';

const SUIT_SYMBOL = Object.freeze({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' });
const diagnostics = {
  reads: 0,
  heroCommits: 0,
  boardCommits: 0,
  rolloverResets: 0,
  lastMs: 0,
  hero: '—',
  board: '—',
  heroSuitConsensus: '—',
  boardRankConsensus: '—',
  boardSuitConsensus: '—',
  heroSuitGeometry: 'dedicated',
  lastError: null,
};
if (typeof window !== 'undefined') window.__prcCardRefinerDiagnostics = diagnostics;

const ocr = new OcrService();
const consensus = new HeroCardConsensus({ windowMs: 520, strongConfidence: 0.76 });
const heroSuitConsensus = new SuitConsensus({ windowMs: 360, slots: 2, allowFacePairCandidates: true });
const boardRankConsensus = new BoardCardConsensus({ windowMs: 420, slots: 5, minHits: 3 });
const boardSuitConsensus = new SuitConsensus({ windowMs: 360, slots: 5 });
let consensusHandId = 0;
let boardConsensusHandId = 0;
let heroBurstUntil = 0;
let busy = false;
let lastReadAt = 0;
let felt = null;
let layout = null;
let lastGeomAt = 0;
const capture = document.createElement('canvas');
const scratchHero = [document.createElement('canvas'), document.createElement('canvas')];
const scratchBoard = Array.from({ length: 5 }, () => document.createElement('canvas'));

function visibleSource() {
  const video = document.getElementById('video');
  if (video && video.style.display !== 'none' && video.readyState >= 2 && video.videoWidth > 0) return video;
  const image = document.getElementById('image');
  if (image && image.style.display !== 'none' && image.complete && image.naturalWidth > 0) return image;
  return null;
}

function captureFrame(source) {
  const sw = source.videoWidth || source.naturalWidth || source.width || 0;
  const sh = source.videoHeight || source.naturalHeight || source.height || 0;
  if (!sw || !sh) return null;
  const scale = Math.min(1, 1000 / sw);
  capture.width = Math.max(320, Math.round(sw * scale));
  capture.height = Math.max(180, Math.round(sh * scale));
  const ctx = capture.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, capture.width, capture.height);
  return { canvas: capture, w: capture.width, h: capture.height };
}

function cardSource(cards) {
  const sources = cards.map((c) => c?.source || '');
  if (sources.includes('teacher')) return 'teacher';
  if (sources.includes('ocr-refiner')) return 'refiner-ocr';
  if (sources.some((s) => ['card-refiner-local', 'hero-suit-refiner', 'hero-rank-confirmed'].includes(s))) return 'refiner';
  if (sources.includes('ocr-fallback')) return 'ocr';
  return 'fast';
}

function syncHeroHand(machine, now = performance.now()) {
  if (!machine || consensusHandId === machine.handId) return false;
  consensusHandId = machine.handId;
  consensus.resetHand(machine.handId);
  heroSuitConsensus.resetHand(machine.handId);
  diagnostics.heroSuitConsensus = '0/2';
  diagnostics.hero = '—';
  diagnostics.rolloverResets++;
  heroBurstUntil = now + 320;
  lastReadAt = 0;
  return true;
}

function installCardConsensus(machine) {
  if (!machine || machine.__prcHeroConsensusInstalled) return;
  const rawSetHero = machine.setHero.bind(machine);
  machine.setHero = (cards, handId) => {
    if (handId !== machine.handId) return false;
    const now = performance.now();
    syncHeroHand(machine, now);
    const observed = consensus.observe(cards, { handId, source: cardSource(cards), now });
    if (!observed.accepted) return false;
    const suitObserved = heroSuitConsensus.observe(cards, { handId, now });
    diagnostics.heroSuitConsensus = `${suitObserved.confirmedCount}/2`;
    const merged = observed.cards.map((c, i) => ({
      ...c,
      suit: suitObserved.cards[i]?.suit || null,
      suitConfidence: suitObserved.cards[i]?.suit ? Math.max(Number(cards[i]?.suitConfidence) || 0, Number(c?.suitConfidence) || 0) : 0,
      suitSource: suitObserved.cards[i]?.suitSource || null,
      voteCount: Number(cards[i]?.voteCount) || 0,
    }));
    return rawSetHero(merged, handId);
  };

  const rawSetBoard = machine.setBoard.bind(machine);
  machine.setBoard = (cards, handId) => {
    if (handId !== machine.handId || !Array.isArray(cards)) return false;
    const now = performance.now();
    if (boardConsensusHandId !== handId) {
      boardConsensusHandId = handId;
      boardRankConsensus.resetHand(handId);
      boardSuitConsensus.resetHand(handId);
      diagnostics.boardRankConsensus = '0/5';
      diagnostics.boardSuitConsensus = '0/5';
    }
    if (!cards.length) return rawSetBoard(cards, handId);

    const rankStable = boardRankConsensus.observe(cards, { handId, now });
    diagnostics.boardRankConsensus = `${rankStable.confirmedCount}/${cards.length}`;
    if (!rankStable.ready) return false;

    const stable = boardSuitConsensus.observe(rankStable.cards, { handId, now });
    diagnostics.boardSuitConsensus = `${stable.confirmedCount}/${cards.length}`;
    const old = machine.state.board || [];
    const merged = stable.cards.map((c, i) => {
      const prev = old[i];
      if (!c || !prev || String(c.rank || '').toUpperCase() !== String(prev.rank || '').toUpperCase()) return c;
      return {
        ...c,
        suit: c.suit || prev.suit || null,
        suitConfidence: Math.max(Number(c.suitConfidence) || 0, Number(prev.suitConfidence) || 0),
        confidence: Math.max(Number(c.confidence) || 0, Number(prev.confidence) || 0),
      };
    });
    return rawSetBoard(merged, handId);
  };
  machine.__prcHeroConsensusInstalled = true;
}

installCardConsensus(activeHandMachine);

function suitMeta(suit) {
  return {
    suitCandidate: suit.candidate || null,
    suitCandidateConfidence: Number(suit.confidence) || 0,
    suitMargin: Number(suit.margin) || 0,
    suitDistance: Number.isFinite(suit.distance) ? suit.distance : 1,
    suitFamily: suit.family || null,
    suitRoi: suit.roi || null,
    voteCount: suit.voteCount || 0,
  };
}

function classifyLocalCard(crop) {
  const rank = classifyRankPixels(crop.data, crop.w, crop.h);
  const suit = classifySuitPixels(crop.data, crop.w, crop.h, rank.rank || null);
  return {
    rank: rank.rank || null,
    suit: suit.suit || null,
    confidence: rank.confidence || 0,
    suitConfidence: suit.suit ? (suit.confidence || 0) : 0,
    source: 'card-refiner-local',
    rankCandidate: rank.candidate || null,
    ...suitMeta(suit),
  };
}

function classifyHeroCard(crop, index, machine) {
  const confirmed = machine?.state?.hero?.[index] || null;
  const confirmedRank = confirmed?.rank || null;
  if (!confirmedRank) return classifyLocalCard(crop);
  const suit = classifySuitPixels(crop.data, crop.w, crop.h, confirmedRank);
  return {
    ...confirmed,
    rank: confirmedRank,
    suit: suit.suit || confirmed?.suit || null,
    confidence: Math.max(Number(confirmed?.confidence) || 0, 0.76),
    suitConfidence: suit.suit ? suit.confidence || 0 : Number(confirmed?.suitConfidence) || 0,
    source: suit.suit ? 'hero-suit-refiner' : (confirmed?.source || 'hero-rank-confirmed'),
    rankCandidate: confirmedRank,
    ...suitMeta(suit),
  };
}

async function completeRank(card, crop, lane) {
  if (card.rank) return card;
  const read = await ocr.readRank(rankCrop(crop.canvas), lane);
  if (!read?.value) return card;
  const suit = classifySuitPixels(crop.data, crop.w, crop.h, read.value);
  return {
    ...card,
    rank: read.value,
    suit: suit.suit || null,
    suitConfidence: suit.suit ? (suit.confidence || 0) : 0,
    ...suitMeta(suit),
    confidence: Math.max(card.confidence || 0, Math.max(0.45, (read.confidence || 0) / 100)),
    source: 'ocr-refiner',
  };
}

function cardLabel(cards, showUnknownSuit = true) {
  return (cards || []).map((c) => `${c?.rank || '?'}${c?.suit ? (SUIT_SYMBOL[c.suit] || '?') : (showUnknownSuit ? '?' : '')}`).join(' ');
}

function syncVisibleCardLabels(machine) {
  if (!machine) return;
  const heroEl = document.getElementById('heroCards');
  const boardEl = document.getElementById('boardCards');
  if (heroEl && machine.state.hero?.length === 2) heroEl.textContent = cardLabel(machine.state.hero, true);
  if (boardEl) boardEl.textContent = machine.state.board?.length ? cardLabel(machine.state.board, true) : '—';
}

async function readOnce() {
  const machine = activeHandMachine;
  const source = visibleSource();
  if (!machine || !source || busy) return;
  const now = performance.now();
  syncHeroHand(machine, now);
  if (now - lastReadAt < 58) return;
  lastReadAt = now;
  const frame = captureFrame(source); if (!frame) return;
  busy = true; const t0 = performance.now(); const handId = machine.handId;
  try {
    if (!layout || now - lastGeomAt > 450) {
      const next = detectFelt(frame);
      if (next) { felt = stabilizeFelt(felt, next); layout = layoutFromFelt(felt); lastGeomAt = now; }
    }
    if (!layout) return;

    const heroSuitSlots = layout.heroSuitSlots || layout.heroSlots;
    const heroCrops = heroSuitSlots.map((slot, i) => cropCanvas(frame.canvas, slot, 112, scratchHero[i]));
    const heroPresent = heroCrops.every((c) => cardPresenceScore(c.data, c.w, c.h) >= 0.24);
    if (heroPresent) {
      let cards = heroCrops.map((crop, i) => classifyHeroCard(crop, i, machine));
      for (let i = 0; i < cards.length; i++) cards[i] = await completeRank(cards[i], heroCrops[i], 'hero-refiner');
      if (machine.handId === handId && cards.every((c) => c.rank)) {
        if (machine.setHero(cards, handId)) diagnostics.heroCommits++;
        diagnostics.hero = cardLabel(cards, true);
      }
    }

    const boardCrops = layout.boardSlots.map((slot, i) => cropCanvas(frame.canvas, slot, 112, scratchBoard[i]));
    const scores = boardCrops.map((c) => cardPresenceScore(c.data, c.w, c.h));
    const count = boardCountFromScores(scores, 0.28);
    if (count > 0) {
      let board = boardCrops.slice(0, count).map(classifyLocalCard);
      for (let i = 0; i < board.length; i++) board[i] = await completeRank(board[i], boardCrops[i], 'board-refiner');
      if (machine.handId === handId && board.length === count && board.every((c) => c.rank)) {
        if (machine.setBoard(board, handId)) diagnostics.boardCommits++;
        diagnostics.board = cardLabel(board, true);
      }
    } else diagnostics.board = '—';

    syncVisibleCardLabels(machine);
    diagnostics.reads++;
    diagnostics.lastError = null;
  } catch (e) {
    diagnostics.lastError = e?.message || 'card-refiner-failed';
  } finally {
    diagnostics.lastMs = performance.now() - t0;
    busy = false;
  }
}

function tick() {
  const machine = activeHandMachine;
  const changed = syncHeroHand(machine);
  syncVisibleCardLabels(machine);
  const urgent = changed || performance.now() < heroBurstUntil;
  if (urgent) {
    void readOnce();
    return;
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => void readOnce(), { timeout: 110 });
  else void readOnce();
}

setInterval(tick, 45);
setTimeout(tick, 90);

import { activeHandMachine } from '../core/state-machine.js';
import { detectFelt, layoutFromFelt, stabilizeFelt } from '../core/geometry.js';
import { cropCanvas, vectorDistance } from '../core/image.js';
import { classifyRankPixels } from '../core/rank-classifier.js';
import { classifySuitPixels } from '../core/suit-classifier.js';
import { HeroCardConsensus } from '../core/hero-card-consensus.js';
import { BoardCardConsensus } from '../core/board-card-consensus.js';
import { SuitConsensus } from '../core/suit-consensus.js';
import { OcrService } from '../core/ocr.js';
import { cardPresenceScore, boardCountFromScores, rankCrop, slotFingerprint } from '../detectors/cards.js';

const SUIT_SYMBOL = Object.freeze({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' });
const diagnostics = {
  reads: 0,
  heroCommits: 0,
  boardCommits: 0,
  rolloverResets: 0,
  visualRedeals: 0,
  lastMs: 0,
  hero: '—',
  board: '—',
  heroSuitConsensus: '—',
  boardRankConsensus: '—',
  boardSuitConsensus: '—',
  heroRankGeometry: 'dedicated-r8',
  heroSuitGeometry: 'dedicated-suit',
  lastError: null,
};
if (typeof window !== 'undefined') window.__prcCardRefinerDiagnostics = diagnostics;

const ocr = new OcrService();
const consensus = new HeroCardConsensus({ windowMs: 560, strongConfidence: 0.76 });
const heroSuitConsensus = new SuitConsensus({ windowMs: 520, slots: 2, allowFacePairCandidates: true, allowCandidates: true, candidateMinHits: 3 });
const boardRankConsensus = new BoardCardConsensus({ windowMs: 460, slots: 5, minHits: 3 });
const boardSuitConsensus = new SuitConsensus({ windowMs: 620, slots: 5, allowCandidates: true, candidateMinHits: 4 });
let consensusHandId = 0;
let boardConsensusHandId = 0;
let heroBurstUntil = 0;
let busy = false;
let lastReadAt = 0;
let felt = null;
let layout = null;
let lastGeomAt = 0;
let visualHeroFp = null;
let visualPendingFp = null;
let visualPendingHits = 0;
let visualGapArmed = false;
let visualQuarantined = false;
const capture = document.createElement('canvas');
const scratchHeroRank = [document.createElement('canvas'), document.createElement('canvas')];
const scratchHeroSuit = [document.createElement('canvas'), document.createElement('canvas')];
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

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dedicatedHeroRankSlots(f) {
  return [0, 1].map((i) => {
    const x = f.x + (0.405 + i * 0.09) * f.w;
    const y = f.y + 0.875 * f.h;
    const w = 0.09 * f.w;
    const h = 0.17 * f.h;
    return { x: clamp(x, 0, 0.995), y: clamp(y, 0, 0.995), w: clamp(w, 0.008, 1 - x), h: clamp(h, 0.008, 1 - y) };
  });
}

function cardSource(cards) {
  const sources = cards.map((c) => c?.source || '');
  if (sources.includes('teacher')) return 'teacher';
  if (sources.includes('ocr-refiner')) return 'refiner-ocr';
  if (sources.some((s) => ['card-refiner-local', 'hero-rank-refiner', 'hero-suit-refiner', 'hero-rank-confirmed'].includes(s))) return 'refiner';
  if (sources.includes('ocr-fallback')) return 'ocr';
  return 'fast';
}

function resetVisualDealState() {
  visualHeroFp = null;
  visualPendingFp = null;
  visualPendingHits = 0;
  visualGapArmed = false;
  visualQuarantined = false;
}

function syncCardHand(machine, now = performance.now()) {
  if (!machine || (consensusHandId === machine.handId && boardConsensusHandId === machine.handId)) return false;
  consensusHandId = machine.handId;
  boardConsensusHandId = machine.handId;
  consensus.resetHand(machine.handId);
  heroSuitConsensus.resetHand(machine.handId);
  boardRankConsensus.resetHand(machine.handId);
  boardSuitConsensus.resetHand(machine.handId);
  diagnostics.heroSuitConsensus = '0/2';
  diagnostics.boardRankConsensus = '0/5';
  diagnostics.boardSuitConsensus = '0/5';
  diagnostics.hero = '—';
  diagnostics.board = '—';
  diagnostics.rolloverResets++;
  heroBurstUntil = now + 520;
  lastReadAt = 0;
  layout = null;
  lastGeomAt = 0;
  resetVisualDealState();
  return true;
}

function quarantineCards(machine) {
  if (!machine?.state || visualQuarantined) return;
  machine.state.hero = [];
  machine.state.board = [];
  machine.state.street = 'preflop';
  machine.state.reason = 'visual-redeal-confirming-r8';
  machine.state.provisionalDecision = null;
  visualQuarantined = true;
  const heroEl = document.getElementById('heroCards');
  const boardEl = document.getElementById('boardCards');
  if (heroEl) heroEl.textContent = '—';
  if (boardEl) boardEl.textContent = '—';
}

function observeVisualDeal(machine, present, crops, now) {
  if (!machine) return false;
  if (!present) {
    if (machine.state?.hero?.length === 2 || visualHeroFp) visualGapArmed = true;
    return false;
  }
  const fp = slotFingerprint(crops);
  if (!fp) return false;
  if (!visualHeroFp) {
    visualHeroFp = fp;
    visualPendingFp = null;
    visualPendingHits = 0;
    return false;
  }
  const distance = vectorDistance(visualHeroFp, fp);
  if (distance < 0.105) {
    visualPendingFp = null;
    visualPendingHits = 0;
    visualGapArmed = false;
    visualQuarantined = false;
    return false;
  }
  if (visualGapArmed) quarantineCards(machine);
  if (visualPendingFp && vectorDistance(visualPendingFp, fp) < 0.055) visualPendingHits++;
  else { visualPendingFp = fp; visualPendingHits = 1; }
  const needed = visualGapArmed ? 2 : 4;
  if (visualPendingHits < needed || now - machine.state.startedAt <= 120) return false;

  machine.newHand(visualGapArmed ? 'visual-redeal-r8' : 'visual-card-change-r8', now);
  diagnostics.visualRedeals++;
  syncCardHand(machine, now);
  visualHeroFp = fp;
  visualPendingFp = null;
  visualPendingHits = 0;
  visualGapArmed = false;
  visualQuarantined = false;
  return true;
}

function installCardConsensus(machine) {
  if (!machine || machine.__prcHeroConsensusInstalled) return;
  const rawSetHero = machine.setHero.bind(machine);
  machine.setHero = (cards, handId) => {
    if (handId !== machine.handId) return false;
    const now = performance.now();
    syncCardHand(machine, now);
    const observed = consensus.observe(cards, { handId, source: cardSource(cards), now });
    if (!observed.accepted) return false;
    const suitObserved = heroSuitConsensus.observe(cards, { handId, now });
    diagnostics.heroSuitConsensus = `${suitObserved.confirmedCount}/2`;
    const merged = observed.cards.map((c, i) => ({
      ...c,
      suit: suitObserved.cards[i]?.suit || c?.suit || null,
      suitConfidence: suitObserved.cards[i]?.suit
        ? Math.max(Number(cards[i]?.suitConfidence) || 0, Number(c?.suitConfidence) || 0)
        : Number(c?.suitConfidence) || 0,
      suitSource: suitObserved.cards[i]?.suitSource || c?.suitSource || null,
      suitCandidate: cards[i]?.suitCandidate || c?.suitCandidate || null,
      suitCandidateConfidence: Math.max(Number(cards[i]?.suitCandidateConfidence) || 0, Number(c?.suitCandidateConfidence) || 0),
      suitMargin: Math.max(Number(cards[i]?.suitMargin) || 0, Number(c?.suitMargin) || 0),
      suitDistance: Number.isFinite(cards[i]?.suitDistance) ? cards[i].suitDistance : c?.suitDistance,
      suitFamily: cards[i]?.suitFamily || c?.suitFamily || null,
      suitRoi: cards[i]?.suitRoi || c?.suitRoi || null,
      voteCount: Math.max(Number(cards[i]?.voteCount) || 0, Number(c?.voteCount) || 0),
    }));
    return rawSetHero(merged, handId);
  };

  const rawSetBoard = machine.setBoard.bind(machine);
  machine.setBoard = (cards, handId) => {
    if (handId !== machine.handId || !Array.isArray(cards)) return false;
    const now = performance.now();
    syncCardHand(machine, now);
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

function safeRankRead(read) {
  if (!read) return read;
  const rank = read.rank || null;
  const second = read.second || null;
  const margin = Number(read.margin) || 0;
  const t8 = (rank === 'T' && second === '8') || (rank === '8' && second === 'T');
  if (t8 && margin < 0.16) return { ...read, rank: null, ambiguousR8: true };
  return read;
}

function classifyLocalCard(crop) {
  const rank = safeRankRead(classifyRankPixels(crop.data, crop.w, crop.h));
  const suit = classifySuitPixels(crop.data, crop.w, crop.h, rank.rank || null);
  return {
    rank: rank.rank || null,
    suit: suit.suit || null,
    confidence: rank.confidence || 0,
    suitConfidence: suit.suit ? (suit.confidence || 0) : 0,
    source: 'card-refiner-local',
    rankCandidate: rank.candidate || null,
    rankSecond: rank.second || null,
    rankMargin: rank.margin || 0,
    ...suitMeta(suit),
  };
}

function classifyHeroCard(rankSlotCrop, suitSlotCrop, index, machine) {
  const confirmed = machine?.state?.hero?.[index] || null;
  const confirmedRank = confirmed?.rank || null;
  const rankRead = confirmedRank ? null : safeRankRead(classifyRankPixels(rankSlotCrop.data, rankSlotCrop.w, rankSlotCrop.h));
  const rank = confirmedRank || rankRead?.rank || null;
  const suit = rank
    ? classifySuitPixels(suitSlotCrop.data, suitSlotCrop.w, suitSlotCrop.h, rank)
    : { suit: null, candidate: null, confidence: 0, margin: 0, distance: 1, family: null, roi: null, voteCount: 0 };

  return {
    ...(confirmed || {}),
    rank,
    suit: suit.suit || confirmed?.suit || null,
    confidence: confirmedRank
      ? Math.max(Number(confirmed?.confidence) || 0, 0.76)
      : Number(rankRead?.confidence) || 0,
    suitConfidence: suit.suit ? suit.confidence || 0 : Number(confirmed?.suitConfidence) || 0,
    source: confirmedRank
      ? (suit.suit ? 'hero-suit-refiner' : (confirmed?.source || 'hero-rank-confirmed'))
      : 'hero-rank-refiner',
    rankCandidate: confirmedRank || rankRead?.candidate || rank,
    rankSecond: rankRead?.second || null,
    rankMargin: rankRead?.margin || 0,
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

async function completeHeroRank(card, rankSlotCrop, suitSlotCrop) {
  if (card.rank) return card;
  const read = await ocr.readRank(rankCrop(rankSlotCrop.canvas), 'hero-refiner');
  if (!read?.value) return card;
  const suit = classifySuitPixels(suitSlotCrop.data, suitSlotCrop.w, suitSlotCrop.h, read.value);
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
  if (heroEl) heroEl.textContent = machine.state.hero?.length === 2 ? cardLabel(machine.state.hero, true) : '—';
  if (boardEl) boardEl.textContent = machine.state.board?.length ? cardLabel(machine.state.board, true) : '—';
}

async function readOnce() {
  const machine = activeHandMachine;
  const source = visibleSource();
  if (!machine || !source || busy) return;
  const now = performance.now();
  syncCardHand(machine, now);
  if (now - lastReadAt < 58) return;
  lastReadAt = now;
  const frame = captureFrame(source); if (!frame) return;
  busy = true; const t0 = performance.now();
  try {
    if (!layout || now - lastGeomAt > 380) {
      const next = detectFelt(frame);
      if (next) { felt = stabilizeFelt(felt, next); layout = layoutFromFelt(felt); lastGeomAt = now; }
    }
    if (!layout || !felt) return;

    const heroRankSlots = dedicatedHeroRankSlots(felt);
    const heroSuitSlots = layout.heroSuitSlots || layout.heroSlots;
    const heroRankCrops = heroRankSlots.map((slot, i) => cropCanvas(frame.canvas, slot, 112, scratchHeroRank[i]));
    const heroSuitCrops = heroSuitSlots.map((slot, i) => cropCanvas(frame.canvas, slot, 112, scratchHeroSuit[i]));
    const heroPresenceScores = heroRankCrops.map((c, i) => Math.max(
      cardPresenceScore(c.data, c.w, c.h),
      cardPresenceScore(heroSuitCrops[i].data, heroSuitCrops[i].w, heroSuitCrops[i].h),
    ));
    const heroPresent = heroPresenceScores.every((s) => s >= 0.17);
    const redealt = observeVisualDeal(machine, heroPresent, heroRankCrops, now);
    if (redealt) heroBurstUntil = performance.now() + 520;
    let handId = machine.handId;

    if (heroPresent) {
      let cards = heroRankCrops.map((crop, i) => classifyHeroCard(crop, heroSuitCrops[i], i, machine));
      for (let i = 0; i < cards.length; i++) cards[i] = await completeHeroRank(cards[i], heroRankCrops[i], heroSuitCrops[i]);
      handId = machine.handId;
      if (cards.every((c) => c.rank)) {
        if (machine.setHero(cards, handId)) diagnostics.heroCommits++;
        diagnostics.hero = cardLabel(cards, true);
      }
    } else {
      diagnostics.hero = '—';
    }

    handId = machine.handId;
    const boardCrops = layout.boardSlots.map((slot, i) => cropCanvas(frame.canvas, slot, 112, scratchBoard[i]));
    const scores = boardCrops.map((c) => cardPresenceScore(c.data, c.w, c.h));
    const count = boardCountFromScores(scores, 0.25);
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
  const changed = syncCardHand(machine);
  syncVisibleCardLabels(machine);
  const urgent = changed || performance.now() < heroBurstUntil;
  if (urgent) {
    void readOnce();
    return;
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => void readOnce(), { timeout: 100 });
  else void readOnce();
}

setInterval(tick, 45);
setTimeout(tick, 90);

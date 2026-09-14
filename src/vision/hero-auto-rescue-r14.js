import { activeHandMachine } from '../core/state-machine.js';
import { detectFelt, layoutFromFelt, stabilizeFelt } from '../core/geometry.js';
import { cropCanvas } from '../core/image.js';
import { classifyRankPixels } from '../core/rank-classifier.js';
import { OcrService } from '../core/ocr.js';
import { classifyPokerStarsSuitPixels } from '../core/pokerstars-suit-scanner.js';
import { BoardCardConsensus } from '../core/board-card-consensus.js';
import { SuitConsensus } from '../core/suit-consensus.js';
import { locateHeroCardSlots } from '../detectors/hero-card-locator.js';
import { cardPresenceScore, rankCrop } from '../detectors/cards.js';

const diagnostics = {
  enabled: true,
  sourceAllowed: false,
  reads: 0,
  bootstraps: 0,
  commits: 0,
  locatedReads: 0,
  geometryReads: 0,
  ocrFallbacks: 0,
  rankConsensus: '0/2',
  suitConsensus: '0/2',
  pairConsensus: '0/2',
  status: 'boot',
  lastSlots: '—',
  lastError: null,
};

if (typeof window !== 'undefined') window.__prcHeroAutoRescueR14 = diagnostics;

const capture = document.createElement('canvas');
const searchScratch = document.createElement('canvas');
const rankScratch = [document.createElement('canvas'), document.createElement('canvas')];
const suitScratch = [document.createElement('canvas'), document.createElement('canvas')];
const probeScratch = [document.createElement('canvas'), document.createElement('canvas')];
const ocr = new OcrService();
const rankConsensus = new BoardCardConsensus({ slots: 2, windowMs: 760, minHits: 3 });
const suitConsensus = new SuitConsensus({
  slots: 2,
  windowMs: 860,
  allowFacePairCandidates: true,
  allowCandidates: true,
  candidateMinHits: 3,
});

let felt = null;
let layout = null;
let lastGeomAt = 0;
let lastReadAt = 0;
let busy = false;
let trackedHandId = -1;
let pairKey = '';
let pairHits = 0;

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function replayAllowed() {
  const replay = typeof window !== 'undefined' ? window.__prcReplayOnlyR14 : null;
  return Boolean(
    (replay?.fileReady && ['video-file', 'image-file'].includes(replay?.sourceKind))
    || (replay?.screenReplayReady === true && replay?.sourceKind === 'screen-replay')
  );
}

function heroLocked() {
  const machine = activeHandMachine;
  const authority = typeof window !== 'undefined' ? window.__prcManualHeroAuthorityR14 : null;
  return Boolean(
    machine
    && authority?.heroLocked
    && Number(authority.handId) === Number(machine.handId)
    && Array.isArray(machine.state?.hero)
    && machine.state.hero.length === 2
    && machine.state.hero.every((card) => card?.rank && card?.suit)
  );
}

function source() {
  const video = document.getElementById('video');
  if (video && video.style.display !== 'none' && video.readyState >= 2 && video.videoWidth > 0) return video;
  const image = document.getElementById('image');
  if (image && image.style.display !== 'none' && image.complete && image.naturalWidth > 0) return image;
  return null;
}

function frameOf(el) {
  const sw = el.videoWidth || el.naturalWidth || el.width || 0;
  const sh = el.videoHeight || el.naturalHeight || el.height || 0;
  if (!sw || !sh) return null;
  const scale = Math.min(1, 1280 / sw);
  capture.width = Math.max(480, Math.round(sw * scale));
  capture.height = Math.max(270, Math.round(sh * scale));
  const ctx = capture.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(el, 0, 0, capture.width, capture.height);
  return { canvas: capture, w: capture.width, h: capture.height };
}

function resetConsensus(handId = activeHandMachine?.handId || 0) {
  trackedHandId = Number(handId) || 0;
  rankConsensus.resetHand(trackedHandId);
  suitConsensus.resetHand(trackedHandId);
  pairKey = '';
  pairHits = 0;
  diagnostics.rankConsensus = '0/2';
  diagnostics.suitConsensus = '0/2';
  diagnostics.pairConsensus = '0/2';
}

function scoreSlots(frame, slots) {
  if (!Array.isArray(slots) || slots.length !== 2) return -1;
  const scores = slots.map((slot, index) => {
    const crop = cropCanvas(frame.canvas, slot, 150, probeScratch[index]);
    return cardPresenceScore(crop.data, crop.w, crop.h);
  });
  return Math.min(...scores);
}

function chooseSlots(frame) {
  const located = locateHeroCardSlots(frame.canvas, felt, searchScratch);
  const candidates = [];
  if (located) candidates.push({ name: 'located', slots: located, score: scoreSlots(frame, located) });
  if (layout?.heroSuitSlots?.length === 2) candidates.push({ name: 'hero-suit-geometry', slots: layout.heroSuitSlots, score: scoreSlots(frame, layout.heroSuitSlots) });
  if (layout?.heroSlots?.length === 2) candidates.push({ name: 'hero-rank-geometry', slots: layout.heroSlots, score: scoreSlots(frame, layout.heroSlots) });
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] || null;
  if (!best || best.score < 0.14) return null;
  diagnostics.lastSlots = `${best.name}:${best.score.toFixed(2)}`;
  if (best.name === 'located') diagnostics.locatedReads++;
  else diagnostics.geometryReads++;
  return best;
}

function localRank(crop) {
  const read = classifyRankPixels(crop.data, crop.w, crop.h);
  if (!read?.rank) return null;
  const confidence = Number(read.confidence) || 0;
  const rank = String(read.rank).toUpperCase();
  const second = read.second ? String(read.second).toUpperCase() : null;
  const margin = Number(read.margin) || 0;
  if (((rank === 'T' && second === '8') || (rank === '8' && second === 'T')) && margin < 0.12) return null;
  if (confidence < 0.48) return null;
  return { rank, suit: null, confidence, source: 'hero-auto-rescue-local' };
}

async function readRank(crop) {
  const local = localRank(crop);
  if (local) return local;
  diagnostics.ocrFallbacks++;
  const read = await ocr.readRank(rankCrop(crop.canvas), 'hero');
  if (!read?.value) return null;
  return {
    rank: String(read.value).toUpperCase(),
    suit: null,
    confidence: Math.max(0.50, Math.min(0.92, (Number(read.confidence) || 0) / 100)),
    source: 'hero-auto-rescue-ocr',
  };
}

function suitRead(card, crop) {
  const read = classifyPokerStarsSuitPixels(crop.data, crop.w, crop.h, card.rank);
  return {
    ...card,
    suit: read.suit || null,
    suitConfidence: read.suit ? Math.max(0.1, Number(read.confidence) || 0) : 0,
    suitCandidate: read.candidate || null,
    suitCandidateConfidence: Number(read.confidence) || 0,
    suitMargin: Number(read.margin) || 0,
    suitDistance: Number.isFinite(read.distance) ? read.distance : 1,
    suitFamily: read.family || null,
    suitRoi: read.roi || null,
    suitScanner: read.scanner || 'pokerstars-suit-r9',
  };
}

function keyOf(cards) {
  if (!Array.isArray(cards) || cards.length !== 2 || cards.some((card) => !card?.rank || !card?.suit)) return '';
  return cards.map((card) => `${String(card.rank).toUpperCase()}:${card.suit}`).join('|');
}

async function tick() {
  const machine = activeHandMachine;
  diagnostics.sourceAllowed = replayAllowed();
  if (!machine || !diagnostics.sourceAllowed || heroLocked() || busy) return;

  const el = source();
  if (!el) {
    diagnostics.status = 'waiting-source';
    return;
  }

  const now = nowMs();
  if (now - lastReadAt < 90) return;
  lastReadAt = now;

  if (machine.handId !== trackedHandId) resetConsensus(machine.handId);
  const frame = frameOf(el);
  if (!frame) return;

  busy = true;
  try {
    if (!layout || now - lastGeomAt > 420) {
      const next = detectFelt(frame);
      if (next) {
        felt = stabilizeFelt(felt, next);
        layout = layoutFromFelt(felt);
        lastGeomAt = now;
      }
    }
    if (!felt || !layout) {
      diagnostics.status = 'waiting-felt';
      return;
    }

    const selected = chooseSlots(frame);
    if (!selected) {
      diagnostics.status = 'locating-cards';
      return;
    }

    const rankSlots = selected.slots;
    const suitSlots = selected.name === 'located'
      ? selected.slots
      : (layout.heroSuitSlots?.length === 2 ? layout.heroSuitSlots : selected.slots);

    const rankCrops = rankSlots.map((slot, index) => cropCanvas(frame.canvas, slot, 190, rankScratch[index]));
    const suitCrops = suitSlots.map((slot, index) => cropCanvas(frame.canvas, slot, 190, suitScratch[index]));

    const rankReads = await Promise.all(rankCrops.map(readRank));
    if (rankReads.some((read) => !read?.rank)) {
      diagnostics.status = 'reading-ranks';
      return;
    }

    const consensusHand = machine.handId || 0;
    if (consensusHand !== trackedHandId) resetConsensus(consensusHand);
    const stableRanks = rankConsensus.observe(rankReads, { handId: consensusHand, now: nowMs() });
    diagnostics.rankConsensus = `${stableRanks.confirmedCount}/2`;
    if (!stableRanks.ready || stableRanks.cards.length !== 2) {
      diagnostics.status = 'rank-consensus';
      return;
    }

    const proposedSuits = stableRanks.cards.map((card, index) => suitRead(card, suitCrops[index]));
    const stableSuits = suitConsensus.observe(proposedSuits, { handId: consensusHand, now: nowMs() });
    diagnostics.suitConsensus = `${stableSuits.confirmedCount}/2`;
    if (stableSuits.confirmedCount !== 2) {
      diagnostics.status = 'suit-consensus';
      return;
    }

    const cards = stableRanks.cards.map((card, index) => ({
      ...card,
      ...proposedSuits[index],
      rank: String(card.rank).toUpperCase(),
      suit: stableSuits.cards[index]?.suit || null,
      confidence: Math.max(0.82, Number(card.confidence) || 0),
      suitConfidence: Math.max(0.82, Number(proposedSuits[index]?.suitConfidence) || Number(proposedSuits[index]?.suitCandidateConfidence) || 0),
      source: 'hero-auto-rescue-r14',
    }));

    if (cards.some((card) => !card.rank || !card.suit)) {
      diagnostics.status = 'pair-incomplete';
      return;
    }
    if (cards[0].rank === cards[1].rank && cards[0].suit === cards[1].suit) {
      diagnostics.status = 'duplicate-card-rejected';
      pairKey = '';
      pairHits = 0;
      return;
    }

    const key = keyOf(cards);
    if (key === pairKey) pairHits++;
    else {
      pairKey = key;
      pairHits = 1;
    }
    diagnostics.pairConsensus = `${Math.min(pairHits, 2)}/2`;
    if (pairHits < 2) {
      diagnostics.status = 'pair-consensus';
      return;
    }

    if (machine.handId <= 0) {
      const boot = machine.observeHero(cards.map((card) => card.rank), true, nowMs());
      if (!boot?.newHand || machine.handId <= 0) {
        diagnostics.status = 'bootstrap-waiting';
        return;
      }
      diagnostics.bootstraps++;
      resetConsensus(machine.handId);
    }

    if (heroLocked()) return;
    const handId = machine.handId;
    const accepted = machine.setHero(cards, handId, { source: 'replay-auto', now: nowMs() });
    if (!accepted) {
      diagnostics.status = 'authority-rejected';
      return;
    }

    diagnostics.commits++;
    diagnostics.reads++;
    diagnostics.status = 'auto-locked';
    diagnostics.lastError = null;
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('prc:hero-auto-confirmed', {
        detail: { generation: handId, cards: cards.map((card) => ({ ...card })), source: 'replay-auto' },
      }));
    }
  } catch (error) {
    diagnostics.lastError = error?.message || 'hero-auto-rescue-failed';
    diagnostics.status = 'error';
  } finally {
    busy = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('prc:generation-change', () => {
    felt = null;
    layout = null;
    lastGeomAt = 0;
    resetConsensus(activeHandMachine?.handId || 0);
  });
  window.addEventListener('prc:replay-source', () => {
    felt = null;
    layout = null;
    lastGeomAt = 0;
    resetConsensus(activeHandMachine?.handId || 0);
  });
  setInterval(() => { void tick(); }, 54);
  setTimeout(() => { void tick(); }, 100);
}

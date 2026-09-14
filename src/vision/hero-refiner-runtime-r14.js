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
  replayOnly: true,
  sourceAllowed: false,
  handId: 0,
  reads: 0,
  located: 0,
  fallbackGeometryReads: 0,
  rankOcrFallbacks: 0,
  rankConsensus: '0/2',
  suitConsensus: '0/2',
  pairConsensus: '0/2',
  commits: 0,
  manualWins: 0,
  fallbackReady: false,
  status: 'boot',
  hero: '—',
  lastMs: 0,
  lastError: null,
};
if (typeof window !== 'undefined') window.__prcHeroRefinerR14 = diagnostics;

const ocr = new OcrService();
const rankConsensus = new BoardCardConsensus({ slots: 2, windowMs: 680, minHits: 3 });
const suitConsensus = new SuitConsensus({
  slots: 2,
  windowMs: 780,
  allowFacePairCandidates: true,
  allowCandidates: true,
  candidateMinHits: 4,
});

const capture = document.createElement('canvas');
const searchScratch = document.createElement('canvas');
const cardScratch = [document.createElement('canvas'), document.createElement('canvas')];
let felt = null;
let layout = null;
let lastGeomAt = 0;
let lastReadAt = 0;
let busy = false;
let trackedHandId = -1;
let pairKey = '';
let pairHits = 0;

const SUIT_SYMBOL = Object.freeze({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' });

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function replayAutoAllowed() {
  if (typeof window === 'undefined') return false;
  const replay = window.__prcReplayOnlyR14;
  const fileReplay = Boolean(
    replay?.fileReady === true
    && (replay?.sourceKind === 'video-file' || replay?.sourceKind === 'image-file')
  );
  const confirmedSharedReplay = Boolean(
    replay?.screenReplayReady === true
    && replay?.sourceKind === 'screen-replay'
  );
  return fileReplay || confirmedSharedReplay;
}

function authority() {
  return typeof window !== 'undefined' ? window.__prcManualHeroAuthorityR14 : null;
}

function heroLockedForHand(machine) {
  const a = authority();
  return Boolean(a?.heroLocked && Number(a.handId) === Number(machine?.handId));
}

function manualOwnsHero(machine) {
  const a = authority();
  return Boolean(heroLockedForHand(machine) && a?.heroSource === 'manual');
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

function resetHand(machine) {
  trackedHandId = Number(machine?.handId) || 0;
  diagnostics.handId = trackedHandId;
  rankConsensus.resetHand(trackedHandId);
  suitConsensus.resetHand(trackedHandId);
  felt = null;
  layout = null;
  lastGeomAt = 0;
  lastReadAt = 0;
  pairKey = '';
  pairHits = 0;
  diagnostics.rankConsensus = '0/2';
  diagnostics.suitConsensus = '0/2';
  diagnostics.pairConsensus = '0/2';
  diagnostics.fallbackReady = false;
  diagnostics.hero = '—';
  diagnostics.status = 'waiting-hero';
}

function cardLabel(cards) {
  return (cards || []).map((card) => `${card?.rank || '?'}${SUIT_SYMBOL[card?.suit] || '?'}`).join(' ');
}

function localRank(crop) {
  const read = classifyRankPixels(crop.data, crop.w, crop.h);
  if (!read?.rank) return null;
  const rank = String(read.rank).toUpperCase();
  const second = read.second ? String(read.second).toUpperCase() : null;
  const margin = Number(read.margin) || 0;
  const confidence = Number(read.confidence) || 0;

  if (((rank === 'T' && second === '8') || (rank === '8' && second === 'T')) && margin < 0.14) return null;
  if (confidence < 0.54) return null;

  return {
    rank,
    suit: null,
    confidence,
    rankMargin: margin,
    source: 'hero-refiner-r14-local',
  };
}

async function rankCard(crop) {
  const local = localRank(crop);
  if (local) return local;

  diagnostics.rankOcrFallbacks++;
  const read = await ocr.readRank(rankCrop(crop.canvas), 'hero');
  if (!read?.value) return null;
  return {
    rank: String(read.value).toUpperCase(),
    suit: null,
    confidence: Math.max(0.50, Math.min(0.92, (Number(read.confidence) || 0) / 100)),
    rankMargin: Number(read.agreement) >= 2 ? 0.20 : 0.10,
    source: 'hero-refiner-r14-ocr',
  };
}

function suitProposal(card, crop) {
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
    source: card.source || 'hero-refiner-r14-local',
  };
}

function fullPairKey(cards) {
  if (!Array.isArray(cards) || cards.length !== 2 || cards.some((card) => !card?.rank || !card?.suit)) return '';
  return cards.map((card) => `${String(card.rank).toUpperCase()}:${card.suit}`).join('|');
}

function duplicatePhysicalCard(cards) {
  if (!Array.isArray(cards) || cards.length !== 2) return false;
  return cards[0]?.rank === cards[1]?.rank && cards[0]?.suit === cards[1]?.suit;
}

function slotsPresent(frame, slots) {
  if (!Array.isArray(slots) || slots.length !== 2) return false;
  const crops = slots.map((slot, index) => cropCanvas(frame.canvas, slot, 180, cardScratch[index]));
  return crops.every((crop) => cardPresenceScore(crop.data, crop.w, crop.h) >= 0.20);
}

function chooseSlots(frame) {
  // Same philosophy as the board lane: stable felt-relative slots are primary.
  // Dynamic card discovery is only a fallback for unusual window/table geometry.
  if (layout?.heroSuitSlots?.length === 2 && slotsPresent(frame, layout.heroSuitSlots)) {
    diagnostics.fallbackGeometryReads++;
    return layout.heroSuitSlots;
  }
  if (layout?.heroSlots?.length === 2 && slotsPresent(frame, layout.heroSlots)) {
    diagnostics.fallbackGeometryReads++;
    return layout.heroSlots;
  }
  const located = locateHeroCardSlots(frame.canvas, felt, searchScratch);
  if (located) diagnostics.located++;
  return located;
}

function updateLabel(cards) {
  const label = cardLabel(cards);
  diagnostics.hero = label;
  const el = document.getElementById('heroCards');
  if (el && label !== '—') el.textContent = label;
}

async function readOnce() {
  const machine = activeHandMachine;
  const el = source();
  diagnostics.sourceAllowed = replayAutoAllowed();
  if (!machine || machine.handId <= 0 || !el || busy) return;
  if (machine.handId !== trackedHandId) resetHand(machine);

  if (!diagnostics.sourceAllowed) {
    diagnostics.status = 'manual-only-unconfirmed-source';
    diagnostics.fallbackReady = true;
    return;
  }

  if (manualOwnsHero(machine)) {
    diagnostics.manualWins++;
    diagnostics.status = 'manual-locked';
    diagnostics.fallbackReady = false;
    return;
  }

  if (heroLockedForHand(machine)) {
    diagnostics.status = 'auto-locked';
    diagnostics.fallbackReady = false;
    updateLabel(machine.state?.hero || []);
    return;
  }

  // In confirmed replay modes, automatic Hero vision stays primary. A modal
  // never interrupts the replay; manual correction remains available by pencil.
  diagnostics.fallbackReady = false;
  const now = nowMs();
  if (now - lastReadAt < 58) return;
  lastReadAt = now;

  const frame = frameOf(el);
  if (!frame) return;
  busy = true;
  const t0 = nowMs();
  const handId = machine.handId;

  try {
    if (!layout || now - lastGeomAt > 380) {
      const next = detectFelt(frame);
      if (next) {
        felt = stabilizeFelt(felt, next);
        layout = layoutFromFelt(felt);
        lastGeomAt = now;
      }
    }
    if (!felt || !layout || machine.handId !== handId) return;

    const slots = chooseSlots(frame);
    if (!slots) {
      diagnostics.status = 'locating-cards';
      return;
    }

    const crops = slots.map((slot, index) => cropCanvas(frame.canvas, slot, 180, cardScratch[index]));
    const present = crops.every((crop) => cardPresenceScore(crop.data, crop.w, crop.h) >= 0.20);
    if (!present) {
      diagnostics.status = 'card-presence-low';
      return;
    }

    const rankReads = await Promise.all(crops.map(rankCard));
    if (machine.handId !== handId || rankReads.some((read) => !read?.rank)) {
      diagnostics.status = 'reading-ranks';
      return;
    }

    const stableRanks = rankConsensus.observe(rankReads, { handId, now: nowMs() });
    diagnostics.rankConsensus = `${stableRanks.confirmedCount}/2`;
    if (!stableRanks.ready || stableRanks.cards.length !== 2) {
      diagnostics.status = 'rank-consensus';
      return;
    }

    const suitReads = stableRanks.cards.map((card, index) => suitProposal(card, crops[index]));
    const stableSuits = suitConsensus.observe(suitReads, { handId, now: nowMs() });
    diagnostics.suitConsensus = `${stableSuits.confirmedCount}/2`;
    if (stableSuits.confirmedCount !== 2) {
      diagnostics.status = 'suit-consensus';
      return;
    }

    const cards = stableRanks.cards.map((card, index) => ({
      ...card,
      ...suitReads[index],
      rank: card.rank,
      suit: stableSuits.cards[index]?.suit || null,
      confidence: Math.max(0.82, Number(card.confidence) || 0),
      suitConfidence: stableSuits.cards[index]?.suit
        ? Math.max(0.84, Number(suitReads[index]?.suitConfidence) || Number(suitReads[index]?.suitCandidateConfidence) || 0)
        : 0,
      source: card.source || 'hero-refiner-r14-local',
    }));

    if (cards.some((card) => !card.rank || !card.suit) || duplicatePhysicalCard(cards)) {
      diagnostics.status = 'full-pair-invalid';
      pairKey = '';
      pairHits = 0;
      return;
    }

    const key = fullPairKey(cards);
    if (key === pairKey) pairHits++;
    else {
      pairKey = key;
      pairHits = 1;
    }
    diagnostics.pairConsensus = `${Math.min(2, pairHits)}/2`;
    updateLabel(cards);
    if (pairHits < 2) {
      diagnostics.status = 'pair-consensus';
      return;
    }

    if (machine.handId !== handId || manualOwnsHero(machine)) return;
    const accepted = machine.setHero(cards, handId, { source: 'replay-auto', now: nowMs() });
    if (!accepted) {
      diagnostics.status = 'authority-rejected';
      return;
    }

    diagnostics.commits++;
    diagnostics.fallbackReady = false;
    diagnostics.status = 'auto-locked';
    updateLabel(cards);
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('prc:hero-auto-confirmed', {
        detail: { generation: handId, cards: cards.map((card) => ({ ...card })), source: 'replay-auto' },
      }));
    }
    diagnostics.lastError = null;
    diagnostics.reads++;
  } catch (error) {
    diagnostics.lastError = error?.message || 'hero-refiner-r14-failed';
    diagnostics.status = 'error';
  } finally {
    diagnostics.lastMs = nowMs() - t0;
    busy = false;
  }
}

function tick() {
  const machine = activeHandMachine;
  if (machine && machine.handId !== trackedHandId) resetHand(machine);
  void readOnce();
}

if (typeof window !== 'undefined') {
  window.addEventListener('prc:replay-source', () => {
    diagnostics.sourceAllowed = replayAutoAllowed();
    if (activeHandMachine) resetHand(activeHandMachine);
  });
  window.addEventListener('prc:manual-state-applied', (event) => {
    if (!event.detail?.hero) return;
    if (Number(event.detail.generation) !== Number(activeHandMachine?.handId)) return;
    diagnostics.status = 'manual-locked';
    diagnostics.fallbackReady = false;
  });
}

setInterval(tick, 48);
setTimeout(tick, 120);

export { replayAutoAllowed };

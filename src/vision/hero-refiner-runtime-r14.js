import { activeHandMachine } from '../core/state-machine.js';
import { detectFelt, layoutFromFelt, stabilizeFelt } from '../core/geometry.js';
import { cropCanvas } from '../core/image.js';
import { classifyRankPixels } from '../core/rank-classifier.js';
import { classifyPokerStarsSuitPixels } from '../core/pokerstars-suit-scanner.js';
import { BoardCardConsensus } from '../core/board-card-consensus.js';
import { SuitConsensus } from '../core/suit-consensus.js';
import { locateHeroCardSlots } from '../detectors/hero-card-locator.js';
import { cardPresenceScore } from '../detectors/cards.js';

const diagnostics = {
  enabled: true,
  localReplayOnly: true,
  sourceAllowed: false,
  handId: 0,
  reads: 0,
  located: 0,
  fallbackGeometryReads: 0,
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

const rankConsensus = new BoardCardConsensus({ slots: 2, windowMs: 620, minHits: 3 });
const suitConsensus = new SuitConsensus({
  slots: 2,
  windowMs: 720,
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
let startedAt = 0;
let pairKey = '';
let pairHits = 0;

const SUIT_SYMBOL = Object.freeze({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' });

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function replayFileAllowed() {
  if (typeof window === 'undefined') return false;
  const replay = window.__prcReplayOnlyR14;
  return Boolean(
    replay?.fileReady === true
    && (replay?.sourceKind === 'video-file' || replay?.sourceKind === 'image-file')
  );
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
  startedAt = nowMs();
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

function safeRank(crop) {
  const read = classifyRankPixels(crop.data, crop.w, crop.h);
  if (!read?.rank) return null;
  const rank = String(read.rank).toUpperCase();
  const second = read.second ? String(read.second).toUpperCase() : null;
  const margin = Number(read.margin) || 0;
  const confidence = Number(read.confidence) || 0;

  // T/8 is the real-world ambiguous pair that previously corrupted Hero reads.
  // Do not let one fuzzy frame vote at all; temporal consensus will wait for a
  // cleaner frame instead of guessing.
  if (((rank === 'T' && second === '8') || (rank === '8' && second === 'T')) && margin < 0.14) return null;
  if (confidence < 0.50) return null;

  return {
    rank,
    suit: null,
    confidence,
    rankMargin: margin,
    source: 'hero-refiner-r14-local',
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
    source: 'hero-refiner-r14-local',
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

function fallbackSlots(frame) {
  if (!layout?.heroSuitSlots?.length) return null;
  const crops = layout.heroSuitSlots.map((slot, index) => cropCanvas(frame.canvas, slot, 170, cardScratch[index]));
  const present = crops.every((crop) => cardPresenceScore(crop.data, crop.w, crop.h) >= 0.22);
  return present ? layout.heroSuitSlots : null;
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
  diagnostics.sourceAllowed = replayFileAllowed();
  if (!machine || machine.handId <= 0 || !el || busy) return;
  if (machine.handId !== trackedHandId) resetHand(machine);

  if (!diagnostics.sourceAllowed) {
    diagnostics.status = 'manual-fallback-screen-replay';
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

  const now = nowMs();
  diagnostics.fallbackReady = now - startedAt >= 1800;
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

    let slots = locateHeroCardSlots(frame.canvas, felt, searchScratch);
    if (slots) diagnostics.located++;
    else {
      slots = fallbackSlots(frame);
      if (slots) diagnostics.fallbackGeometryReads++;
    }
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

    const rankReads = crops.map(safeRank);
    if (rankReads.some((read) => !read?.rank)) {
      diagnostics.status = 'reading-ranks';
      return;
    }

    const stableRanks = rankConsensus.observe(rankReads, { handId, now });
    diagnostics.rankConsensus = `${stableRanks.confirmedCount}/2`;
    if (!stableRanks.ready || stableRanks.cards.length !== 2) {
      diagnostics.status = 'rank-consensus';
      return;
    }

    const suitReads = stableRanks.cards.map((card, index) => suitProposal(card, crops[index]));
    const stableSuits = suitConsensus.observe(suitReads, { handId, now });
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
      suitConfidence: stableSuits.cards[index]?.suit ? Math.max(0.84, Number(suitReads[index]?.suitConfidence) || Number(suitReads[index]?.suitCandidateConfidence) || 0) : 0,
      source: 'hero-refiner-r14-local',
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
    const accepted = machine.setHero(cards, handId, { source: 'replay-auto', now });
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
    diagnostics.sourceAllowed = replayFileAllowed();
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

export { replayFileAllowed };

import { activeHandMachine } from '../core/state-machine.js';
import { detectFelt, layoutFromFelt, stabilizeFelt } from '../core/geometry.js';
import { cropCanvas } from '../core/image.js';
import { classifyPokerStarsSuitPixels } from '../core/pokerstars-suit-scanner.js';
import { cardPresenceScore } from '../detectors/cards.js';
import { SuitConsensus } from '../core/suit-consensus.js';

const diagnostics = {
  reads: 0,
  heroSuitCommits: 0,
  boardSuitCommits: 0,
  manualResets: 0,
  lastMs: 0,
  hero: '—',
  board: '—',
  lastError: null,
};
if (typeof window !== 'undefined') window.__prcSuitScannerR9 = diagnostics;

const heroConsensus = new SuitConsensus({ windowMs: 420, slots: 2, allowCandidates: true, candidateMinHits: 2 });
const boardConsensus = new SuitConsensus({ windowMs: 520, slots: 5, allowCandidates: true, candidateMinHits: 2 });
let consensusHandId = -1;
let felt = null;
let layout = null;
let lastGeomAt = 0;
let lastReadAt = 0;
let busy = false;

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
  const scale = Math.min(1, 1280 / sw);
  capture.width = Math.max(480, Math.round(sw * scale));
  capture.height = Math.max(270, Math.round(sh * scale));
  const ctx = capture.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, capture.width, capture.height);
  return { canvas: capture, w: capture.width, h: capture.height };
}

function syncHand(machine) {
  if (!machine || machine.handId === consensusHandId) return;
  consensusHandId = machine.handId;
  heroConsensus.resetHand(machine.handId);
  boardConsensus.resetHand(machine.handId);
  diagnostics.hero = '—';
  diagnostics.board = '—';
  felt = null;
  layout = null;
  lastGeomAt = 0;
  lastReadAt = 0;
}

function suitCard(base, read) {
  return {
    ...base,
    suit: read.suit || base?.suit || null,
    suitConfidence: read.suit ? Math.max(Number(base?.suitConfidence) || 0, Number(read.confidence) || 0) : Number(base?.suitConfidence) || 0,
    suitCandidate: read.candidate || base?.suitCandidate || null,
    suitCandidateConfidence: Math.max(Number(base?.suitCandidateConfidence) || 0, Number(read.confidence) || 0),
    suitMargin: Math.max(Number(base?.suitMargin) || 0, Number(read.margin) || 0),
    suitDistance: Number.isFinite(read.distance) ? read.distance : base?.suitDistance,
    suitFamily: read.family || base?.suitFamily || null,
    suitRoi: read.roi || base?.suitRoi || null,
    suitScanner: read.scanner || 'pokerstars-suit-r9',
    source: base?.source || 'hero-rank-confirmed',
  };
}

function suitSymbol(suit) {
  return suit === 'clubs' ? '♣' : suit === 'diamonds' ? '♦' : suit === 'hearts' ? '♥' : suit === 'spades' ? '♠' : '?';
}

async function readOnce() {
  const machine = activeHandMachine;
  const source = visibleSource();
  if (!machine || !source || busy) return;
  syncHand(machine);
  const now = performance.now();
  const urgent = machine.state?.heroToAct || machine.state?.hero?.some((c) => c?.rank && !c?.suit) || machine.state?.board?.some((c) => c?.rank && !c?.suit);
  const minGap = urgent ? 54 : 130;
  if (now - lastReadAt < minGap) return;
  lastReadAt = now;
  const frame = captureFrame(source);
  if (!frame) return;
  busy = true;
  const t0 = performance.now();
  const handId = machine.handId;
  try {
    if (!layout || now - lastGeomAt > 420) {
      const next = detectFelt(frame);
      if (next) {
        felt = stabilizeFelt(felt, next);
        layout = layoutFromFelt(felt);
        lastGeomAt = now;
      }
    }
    if (!layout || machine.handId !== handId) return;

    const hero = machine.state.hero || [];
    if (hero.length === 2 && hero.every((c) => c?.rank)) {
      const heroSlots = layout.heroSuitSlots || layout.heroSlots;
      const crops = heroSlots.map((slot, i) => cropCanvas(frame.canvas, slot, 144, scratchHero[i]));
      const present = crops.every((c) => cardPresenceScore(c.data, c.w, c.h) >= 0.22);
      if (present) {
        const reads = crops.map((crop, i) => classifyPokerStarsSuitPixels(crop.data, crop.w, crop.h, hero[i].rank));
        const proposal = hero.map((card, i) => suitCard(card, reads[i]));
        const stable = heroConsensus.observe(proposal, { handId, now });
        diagnostics.hero = proposal.map((c, i) => `${c.rank}${suitSymbol(stable.cards[i]?.suit || c.suit || c.suitCandidate)}`).join(' ');
        if (machine.handId === handId && stable.confirmedCount > 0) {
          const merged = hero.map((card, i) => ({
            ...card,
            ...proposal[i],
            suit: stable.cards[i]?.suit || card.suit || null,
            suitConfidence: stable.cards[i]?.suit
              ? Math.max(Number(card.suitConfidence) || 0, Number(proposal[i].suitCandidateConfidence) || 0)
              : Number(card.suitConfidence) || 0,
          }));
          if (machine.setHero(merged, handId)) diagnostics.heroSuitCommits++;
        }
      }
    }

    const board = machine.state.board || [];
    if ([3, 4, 5].includes(board.length) && board.every((c) => c?.rank)) {
      const crops = layout.boardSlots.slice(0, board.length).map((slot, i) => cropCanvas(frame.canvas, slot, 144, scratchBoard[i]));
      const reads = crops.map((crop, i) => classifyPokerStarsSuitPixels(crop.data, crop.w, crop.h, board[i].rank));
      const proposal = board.map((card, i) => suitCard(card, reads[i]));
      const stable = boardConsensus.observe(proposal, { handId, now });
      diagnostics.board = proposal.map((c, i) => `${c.rank}${suitSymbol(stable.cards[i]?.suit || c.suit || c.suitCandidate)}`).join(' ');
      if (machine.handId === handId && stable.confirmedCount > 0) {
        const merged = board.map((card, i) => ({
          ...card,
          ...proposal[i],
          suit: stable.cards[i]?.suit || card.suit || null,
          suitConfidence: stable.cards[i]?.suit
            ? Math.max(Number(card.suitConfidence) || 0, Number(proposal[i].suitCandidateConfidence) || 0)
            : Number(card.suitConfidence) || 0,
        }));
        if (machine.setBoard(merged, handId)) diagnostics.boardSuitCommits++;
      }
    }

    diagnostics.reads++;
    diagnostics.lastError = null;
  } catch (e) {
    diagnostics.lastError = e?.message || 'suit-scanner-r9-failed';
  } finally {
    diagnostics.lastMs = performance.now() - t0;
    busy = false;
  }
}

function tick() {
  syncHand(activeHandMachine);
  const urgent = activeHandMachine?.state?.heroToAct || activeHandMachine?.state?.hero?.some((c) => c?.rank && !c?.suit) || activeHandMachine?.state?.board?.some((c) => c?.rank && !c?.suit);
  if (urgent) {
    void readOnce();
    return;
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => void readOnce(), { timeout: 180 });
  else void readOnce();
}

if (typeof window !== 'undefined') {
  window.addEventListener('prc:recalibrate', (event) => {
    const token = event?.detail?.token || null;
    const machine = activeHandMachine;
    if (!machine || !token || token.generation !== machine.handId) return;
    heroConsensus.resetHand(machine.handId);
    boardConsensus.resetHand(machine.handId);
    felt = null;
    layout = null;
    lastGeomAt = 0;
    lastReadAt = 0;
    diagnostics.manualResets++;
  });
}

setInterval(tick, 55);
setTimeout(tick, 120);

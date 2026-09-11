import { activeHandMachine } from '../core/state-machine.js';
import { detectFelt, layoutFromFelt, stabilizeFelt } from '../core/geometry.js';
import { cropCanvas, vectorDistance } from '../core/image.js';
import { classifyRankPixels } from '../core/rank-classifier.js';
import { classifyPokerStarsSuitPixels } from '../core/pokerstars-suit-scanner.js';
import { OcrService } from '../core/ocr.js';
import { cardPresenceScore, rankCrop, slotFingerprint } from '../detectors/cards.js';

const SUIT_SYMBOL = Object.freeze({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' });
const diagnostics = {
  reads: 0,
  commits: 0,
  relatches: 0,
  restores: 0,
  handIdRebinds: 0,
  absentFrames: 0,
  candidateHits: 0,
  generationLocks: 0,
  manualRebinds: 0,
  hero: '—',
  lastError: null,
};
if (typeof window !== 'undefined') window.__prcHeroAuthorityR11 = diagnostics;

const ocr = new OcrService();
const capture = document.createElement('canvas');
const scratchHero = [document.createElement('canvas'), document.createElement('canvas')];
let felt = null;
let layout = null;
let lastGeomAt = 0;
let lastReadAt = 0;
let busy = false;
let seenHandId = -1;
let latch = null;
let latchFp = null;
let boardDisplayLatch = [];
let candidateKey = null;
let candidateCards = null;
let candidateFp = null;
let candidateHits = 0;
let absentSince = 0;
let absentFrames = 0;
let gapArmed = false;
let manualRebindToken = null;

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

function label(cards) {
  return (cards || []).map((c) => `${c?.rank || '?'}${c?.suit ? (SUIT_SYMBOL[c.suit] || '?') : '?'}`).join(' ');
}

function resetCandidate() {
  candidateKey = null;
  candidateCards = null;
  candidateFp = null;
  candidateHits = 0;
  diagnostics.candidateHits = 0;
}

// handId is bookkeeping; confirmed visual cards survive bookkeeping churn unless
// a real physical card gap armed a redeal. Rank disagreement by itself is noise.
function onHandId(machine) {
  if (!machine || machine.handId === seenHandId) return;
  const previous = seenHandId;
  seenHandId = machine.handId;
  resetCandidate();

  if (latch && !gapArmed && absentFrames < 4) {
    latch.handId = machine.handId;
    diagnostics.handIdRebinds++;
  }

  if (previous < 0) {
    absentSince = 0;
    absentFrames = 0;
    gapArmed = false;
  }
}

function publish(machine) {
  if (!machine) return;
  const heroEl = document.getElementById('heroCards');
  const boardEl = document.getElementById('boardCards');

  if (latch?.cards?.length === 2) {
    const sameGeneration = latch.handId === machine.handId;
    if (sameGeneration) {
      const current = machine.state.hero || [];
      const same = current.length === 2 && current.every((c, i) => String(c?.rank || '') === String(latch.cards[i]?.rank || ''));
      if (!same || current.some((c, i) => !c?.suit && latch.cards[i]?.suit)) {
        if (machine.setHero(latch.cards.map((c) => ({ ...c })), machine.handId)) diagnostics.restores++;
      }
    }
    if (heroEl) heroEl.textContent = label(latch.cards);
  }

  const board = machine.state.board || [];
  if (board.length) boardDisplayLatch = board.map((c) => ({ ...c }));
  if (boardEl) {
    if (board.length) boardEl.textContent = label(board);
    else if (boardDisplayLatch.length && ['flop', 'turn', 'river'].includes(machine.state.street)) boardEl.textContent = label(boardDisplayLatch);
  }
}

async function rankForCrop(crop) {
  const local = classifyRankPixels(crop.data, crop.w, crop.h);
  const rank = local?.rank || null;
  const second = local?.second || null;
  const margin = Number(local?.margin) || 0;
  const t8Ambiguous = ((rank === 'T' && second === '8') || (rank === '8' && second === 'T')) && margin < 0.18;
  if (rank && !t8Ambiguous && (Number(local?.confidence) || 0) >= 0.48) {
    return { rank, confidence: Number(local.confidence) || 0.5, source: 'hero-authority-local' };
  }
  const read = await ocr.readRank(rankCrop(crop.canvas), 'hero-authority-r11');
  if (!read?.value) return rank && !t8Ambiguous ? { rank, confidence: Number(local?.confidence) || 0.35, source: 'hero-authority-local-soft' } : null;
  return { rank: read.value, confidence: Math.max(0.5, (Number(read.confidence) || 0) / 100), source: 'hero-authority-ocr' };
}

function suitForCrop(crop, rank) {
  const read = classifyPokerStarsSuitPixels(crop.data, crop.w, crop.h, rank);
  return {
    suit: read?.suit || read?.candidate || null,
    confidence: Number(read?.confidence) || 0,
    source: 'pokerstars-suit-r9',
  };
}

function candidateIdentity(cards) {
  if (!cards?.length || cards.some((c) => !c?.rank)) return null;
  return cards.map((c) => `${c.rank}:${c.suit || '?'}`).join('|');
}

function commit(machine, cards, fp, reason) {
  if (!machine || cards?.length !== 2 || cards.some((c) => !c?.rank)) return false;
  const now = performance.now();
  const ranksChanged = latch?.cards?.length === 2 && cards.some((c, i) => c.rank !== latch.cards[i].rank);
  const sameGeneration = latch?.handId === machine.handId;
  const manualRebind = Boolean(manualRebindToken && manualRebindToken.generation === machine.handId);

  // Critical R14 rule: a visual/rank mismatch can NEVER create a new generation.
  // Only a sustained physical absence can arm a redeal. This closes 7 -> 3 -> 2.
  if (sameGeneration && ranksChanged && !gapArmed && !manualRebind) {
    diagnostics.generationLocks++;
    resetCandidate();
    return false;
  }

  if (sameGeneration && ranksChanged && gapArmed) {
    machine.newHand('hero-authority-physical-redeal-r14', now);
    seenHandId = machine.handId;
    boardDisplayLatch = [];
    diagnostics.relatches++;
  }

  const handId = machine.handId;
  const nextCards = cards.map((c) => ({ ...c, authority: 'r14' }));
  const options = manualRebind && handId === manualRebindToken.generation
    ? { rebindToken: manualRebindToken, now }
    : { now };
  if (!machine.setHero(nextCards, handId, options)) {
    if (ranksChanged) diagnostics.generationLocks++;
    resetCandidate();
    return false;
  }

  if (manualRebind && ranksChanged) diagnostics.manualRebinds++;
  latch = { handId, cards: nextCards.map((c) => ({ ...c })), reason, confirmedAt: now };
  latchFp = fp;
  machine.state.reason = machine.state.reason === 'waiting' ? 'hero-authority-r14' : machine.state.reason;
  diagnostics.commits++;
  diagnostics.hero = label(latch.cards);
  gapArmed = false;
  absentSince = 0;
  absentFrames = 0;
  manualRebindToken = null;
  resetCandidate();
  publish(machine);
  return true;
}

async function readOnce() {
  const machine = activeHandMachine;
  const source = visibleSource();
  if (!machine || !source || busy) return;
  onHandId(machine);
  const now = performance.now();
  if (now - lastReadAt < 62) return;
  lastReadAt = now;
  const frame = captureFrame(source);
  if (!frame) return;
  busy = true;
  const startedHandId = machine.handId;
  try {
    if (!layout || now - lastGeomAt > 360) {
      const next = detectFelt(frame);
      if (next) {
        felt = stabilizeFelt(felt, next);
        layout = layoutFromFelt(felt);
        lastGeomAt = now;
      }
    }
    if (!layout) return;

    const slots = layout.heroSuitSlots || layout.heroSlots;
    const crops = slots.map((slot, i) => cropCanvas(frame.canvas, slot, 160, scratchHero[i]));
    const scores = crops.map((c) => cardPresenceScore(c.data, c.w, c.h));
    const present = scores.every((s) => s >= 0.14);

    if (!present) {
      absentFrames++;
      diagnostics.absentFrames = absentFrames;
      if (!absentSince) absentSince = now;
      if (absentFrames >= 4 && now - absentSince >= 140) gapArmed = true;
      publish(machine);
      return;
    }

    absentFrames = 0;
    diagnostics.absentFrames = 0;
    absentSince = 0;
    const fp = slotFingerprint(crops);

    const rankReads = await Promise.all(crops.map(rankForCrop));
    if (machine.handId !== startedHandId) {
      onHandId(machine);
      publish(machine);
      return;
    }
    if (rankReads.some((r) => !r?.rank)) {
      publish(machine);
      return;
    }

    const cards = rankReads.map((r, i) => {
      const suit = suitForCrop(crops[i], r.rank);
      return {
        rank: r.rank,
        suit: suit.suit,
        confidence: r.confidence,
        suitConfidence: suit.confidence,
        source: r.source,
        suitSource: suit.source,
      };
    });

    if (latch?.handId === machine.handId && latch.cards.every((c, i) => c.rank === cards[i].rank)) {
      let improved = false;
      const merged = latch.cards.map((old, i) => {
        const incoming = cards[i];
        if (!old.suit && incoming.suit) improved = true;
        return {
          ...old,
          suit: old.suit || incoming.suit || null,
          suitConfidence: Math.max(Number(old.suitConfidence) || 0, Number(incoming.suitConfidence) || 0),
        };
      });
      if (machine.setHero(merged, machine.handId)) {
        latch.cards = merged;
        latchFp = fp || latchFp;
        if (improved) diagnostics.commits++;
        diagnostics.hero = label(merged);
      }
      publish(machine);
      diagnostics.reads++;
      diagnostics.lastError = null;
      return;
    }

    const key = candidateIdentity(cards);
    const sameCandidate = candidateKey === key && (!candidateFp || !fp || vectorDistance(candidateFp, fp) < 0.075);
    if (sameCandidate) candidateHits++;
    else {
      candidateKey = key;
      candidateCards = cards;
      candidateFp = fp;
      candidateHits = 1;
    }
    diagnostics.candidateHits = candidateHits;

    const manualRebind = Boolean(manualRebindToken && manualRebindToken.generation === machine.handId);
    const needed = latch ? ((gapArmed || manualRebind) ? 2 : 4) : 2;
    if (candidateHits >= needed) commit(machine, candidateCards, candidateFp, manualRebind ? 'manual-recalibration' : (latch ? 'relatch' : 'initial'));
    publish(machine);
    diagnostics.reads++;
    diagnostics.lastError = null;
  } catch (e) {
    diagnostics.lastError = e?.message || 'hero-authority-r14-failed';
    publish(machine);
  } finally {
    busy = false;
  }
}

function tick() {
  const machine = activeHandMachine;
  onHandId(machine);
  publish(machine);
  void readOnce();
}

if (typeof window !== 'undefined') {
  window.addEventListener('prc:recalibrate', (event) => {
    const token = event?.detail?.token || null;
    if (!token || token.generation !== activeHandMachine?.handId) return;
    manualRebindToken = token;
    felt = null;
    layout = null;
    lastGeomAt = 0;
    lastReadAt = 0;
    resetCandidate();
  });
}

setInterval(tick, 55);
setTimeout(tick, 80);

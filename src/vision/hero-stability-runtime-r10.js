import { activeHandMachine } from '../core/state-machine.js';
import { detectFelt, stabilizeFelt } from '../core/geometry.js';
import { cropCanvas, vectorDistance } from '../core/image.js';
import { classifyRankPixels } from '../core/rank-classifier.js';
import { classifyPokerStarsSuitPixels } from '../core/pokerstars-suit-scanner.js';
import { locateHeroCardSlots } from '../detectors/hero-card-locator.js';
import { slotFingerprint } from '../detectors/cards.js';

const SUIT_SYMBOL = Object.freeze({ clubs:'♣', diamonds:'♦', hearts:'♥', spades:'♠' });
const diagnostics = {
  reads: 0,
  located: 0,
  commits: 0,
  restores: 0,
  boardRestores: 0,
  lastMs: 0,
  lastError: null,
  hero: '—',
  source: 'hero-visual-locator-r10',
};
if (typeof window !== 'undefined') window.__prcHeroR10 = diagnostics;

const capture = document.createElement('canvas');
const searchScratch = document.createElement('canvas');
const cardScratch = [document.createElement('canvas'), document.createElement('canvas')];
let felt = null;
let lastGeomAt = 0;
let busy = false;
let lastReadAt = 0;
let trackedHandId = -1;
let latchedHero = null;
let latchedFp = null;
let pendingKey = null;
let pendingHits = 0;
let missingSince = 0;
let gapArmed = false;
let cachedBoard = [];
let cachedStreet = 'preflop';

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

function resetForHand(machine) {
  trackedHandId = machine?.handId ?? -1;
  latchedHero = null;
  latchedFp = null;
  pendingKey = null;
  pendingHits = 0;
  missingSince = 0;
  gapArmed = false;
  cachedBoard = Array.isArray(machine?.state?.board) ? machine.state.board.map((c) => ({ ...c })) : [];
  cachedStreet = machine?.state?.street || 'preflop';
}

function cardLabel(cards) {
  return (cards || []).map((c) => `${c?.rank || '?'}${c?.suit ? (SUIT_SYMBOL[c.suit] || '?') : '?'}`).join(' ');
}

function rankSafe(read) {
  if (!read?.rank) return null;
  const rank = String(read.rank).toUpperCase();
  const second = read.second ? String(read.second).toUpperCase() : null;
  const margin = Number(read.margin) || 0;
  if (((rank === 'T' && second === '8') || (rank === '8' && second === 'T')) && margin < 0.13) return null;
  return { rank, confidence: Number(read.confidence) || 0, margin };
}

function classify(crop) {
  const rankRead = rankSafe(classifyRankPixels(crop.data, crop.w, crop.h));
  if (!rankRead) return null;
  const suitRead = classifyPokerStarsSuitPixels(crop.data, crop.w, crop.h, rankRead.rank);
  return {
    rank: rankRead.rank,
    suit: suitRead.suit || null,
    confidence: Math.max(0.72, rankRead.confidence || 0),
    suitConfidence: suitRead.suit ? Math.max(0.84, Number(suitRead.confidence) || 0) : 0,
    suitCandidate: suitRead.candidate || null,
    suitCandidateConfidence: Number(suitRead.confidence) || 0,
    suitMargin: Number(suitRead.margin) || 0,
    suitDistance: Number.isFinite(suitRead.distance) ? suitRead.distance : 1,
    suitFamily: suitRead.family || null,
    suitScanner: suitRead.scanner || 'pokerstars-r9',
    source: 'hero-visual-r10',
  };
}

function canonicalKey(cards) {
  if (!cards?.length || cards.some((c) => !c?.rank)) return null;
  return cards.map((c) => `${c.rank}${c.suit || c.suitCandidate || '?'}`).join('|');
}

function sameHero(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 2 || b.length !== 2) return false;
  return a.every((c, i) => c?.rank === b[i]?.rank && (!c?.suit || !b[i]?.suit || c.suit === b[i].suit));
}

function mergeHero(oldCards, newCards) {
  return newCards.map((c, i) => {
    const old = oldCards?.[i] || {};
    return {
      ...old,
      ...c,
      rank: c.rank || old.rank,
      suit: c.suit || old.suit || null,
      confidence: Math.max(Number(old.confidence) || 0, Number(c.confidence) || 0),
      suitConfidence: Math.max(Number(old.suitConfidence) || 0, Number(c.suitConfidence) || 0),
    };
  });
}

function commitHero(machine, cards) {
  const merged = mergeHero(latchedHero || machine.state.hero || [], cards);
  latchedHero = merged.map((c) => ({ ...c }));
  // This R10 lane is intentionally authoritative for visible Hero cards. It only
  // runs after physically locating both white card faces and confirming ranks.
  machine.state.hero = latchedHero.map((c) => ({ ...c }));
  diagnostics.commits++;
  diagnostics.hero = cardLabel(latchedHero);
  const el = document.getElementById('heroCards');
  if (el) el.textContent = diagnostics.hero;
}

function restoreLatched(machine) {
  if (!latchedHero || trackedHandId !== machine.handId) return;
  if (!sameHero(machine.state.hero, latchedHero)) {
    machine.state.hero = latchedHero.map((c) => ({ ...c }));
    diagnostics.restores++;
  }
  const el = document.getElementById('heroCards');
  if (el && el.textContent !== cardLabel(latchedHero)) el.textContent = cardLabel(latchedHero);
}

function preserveBoard(machine) {
  const board = Array.isArray(machine.state.board) ? machine.state.board : [];
  if (board.length) {
    cachedBoard = board.map((c) => ({ ...c }));
    cachedStreet = machine.state.street;
    return;
  }
  if (!cachedBoard.length || trackedHandId !== machine.handId) return;
  // Same handId + sudden empty board is a transient visual dropout. Preserve the
  // last confirmed board until the lifecycle actually rotates the handId.
  machine.state.board = cachedBoard.map((c) => ({ ...c }));
  machine.state.street = cachedStreet;
  diagnostics.boardRestores++;
  const boardEl = document.getElementById('boardCards');
  if (boardEl) boardEl.textContent = cardLabel(cachedBoard);
}

async function readOnce() {
  const machine = activeHandMachine;
  const source = visibleSource();
  if (!machine || !source || busy) return;
  const now = performance.now();
  if (machine.handId !== trackedHandId) resetForHand(machine);
  if (now - lastReadAt < 46) { restoreLatched(machine); preserveBoard(machine); return; }
  lastReadAt = now;
  const frame = captureFrame(source);
  if (!frame) return;
  busy = true;
  const t0 = performance.now();
  try {
    if (!felt || now - lastGeomAt > 360) {
      const next = detectFelt(frame);
      if (next) { felt = stabilizeFelt(felt, next); lastGeomAt = now; }
    }
    if (!felt) { restoreLatched(machine); preserveBoard(machine); return; }

    const slots = locateHeroCardSlots(frame.canvas, felt, searchScratch);
    if (!slots) {
      if (!missingSince) missingSince = now;
      if (now - missingSince >= 180) gapArmed = true;
      restoreLatched(machine);
      preserveBoard(machine);
      return;
    }

    diagnostics.located++;
    const crops = slots.map((slot, i) => cropCanvas(frame.canvas, slot, 160, cardScratch[i]));
    const fp = slotFingerprint(crops);
    const gapMs = missingSince ? now - missingSince : 0;
    missingSince = 0;

    // A true redeal normally has a physical gap. If the cards after the gap are
    // materially different, rotate immediately instead of carrying old Hero data.
    if (gapArmed && latchedFp && fp && vectorDistance(latchedFp, fp) > 0.11 && gapMs >= 120) {
      machine.newHand('hero-visual-redeal-r10', now);
      resetForHand(machine);
    }
    gapArmed = false;

    const reads = crops.map(classify);
    if (reads.every(Boolean)) {
      const key = canonicalKey(reads);
      if (key && key === pendingKey) pendingHits++;
      else { pendingKey = key; pendingHits = 1; }

      const allSuitDirect = reads.every((c) => c.suit);
      const enough = allSuitDirect ? 2 : 3;
      if (pendingHits >= enough) {
        if (!latchedHero || !sameHero(latchedHero, reads)) latchedFp = fp;
        commitHero(machine, reads);
      }
    }

    restoreLatched(machine);
    preserveBoard(machine);
    diagnostics.reads++;
    diagnostics.lastError = null;
  } catch (e) {
    diagnostics.lastError = e?.message || 'hero-r10-failed';
    restoreLatched(activeHandMachine);
    preserveBoard(activeHandMachine);
  } finally {
    diagnostics.lastMs = performance.now() - t0;
    busy = false;
  }
}

function tick() {
  const machine = activeHandMachine;
  if (machine && machine.handId !== trackedHandId) resetForHand(machine);
  restoreLatched(machine);
  preserveBoard(machine);
  void readOnce();
}

setInterval(tick, 42);
setTimeout(tick, 80);

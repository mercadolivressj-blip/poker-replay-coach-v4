import { activeHandMachine } from '../core/state-machine.js';
import { detectFelt, layoutFromFelt, stabilizeFelt } from '../core/geometry.js';
import { cropCanvas } from '../core/image.js';
import { classifyRankPixels } from '../core/rank-classifier.js';
import { OcrService } from '../core/ocr.js';
import { BoardCardConsensus } from '../core/board-card-consensus.js';
import { cardPresenceScore, boardCountFromScores, rankCrop } from '../detectors/cards.js';

const diagnostics = { reads: 0, commits: 0, manualRebinds: 0, manualZeroHits: 0, lastMs: 0, consensus: '0/5', lastError: null };
if (typeof window !== 'undefined') window.__prcBoardRefinerR14 = diagnostics;

const ocr = new OcrService();
const consensus = new BoardCardConsensus({ windowMs: 520, slots: 5, minHits: 3 });
const capture = document.createElement('canvas');
const scratch = Array.from({ length: 5 }, () => document.createElement('canvas'));
let felt = null;
let layout = null;
let lastGeomAt = 0;
let lastReadAt = 0;
let consensusHandId = -1;
let busy = false;
let manualRebindToken = null;
let manualZeroHits = 0;

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
  const scale = Math.min(1, 1000 / sw);
  capture.width = Math.max(320, Math.round(sw * scale));
  capture.height = Math.max(180, Math.round(sh * scale));
  const ctx = capture.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(el, 0, 0, capture.width, capture.height);
  return { canvas: capture, w: capture.width, h: capture.height };
}

function syncHand(machine) {
  if (!machine || machine.handId === consensusHandId) return;
  consensusHandId = machine.handId;
  consensus.resetHand(machine.handId);
  felt = null;
  layout = null;
  lastGeomAt = 0;
  manualRebindToken = null;
  manualZeroHits = 0;
  diagnostics.manualZeroHits = 0;
  diagnostics.consensus = '0/5';
}

async function rankCard(crop) {
  const local = classifyRankPixels(crop.data, crop.w, crop.h);
  if (local?.rank && (Number(local.confidence) || 0) >= 0.54) {
    return { rank: local.rank, suit: null, confidence: Number(local.confidence) || 0.54, source: 'board-r14-local' };
  }
  const read = await ocr.readRank(rankCrop(crop.canvas), 'board');
  if (!read?.value) return null;
  return { rank: read.value, suit: null, confidence: Math.max(0.5, (Number(read.confidence) || 0) / 100), source: 'board-r14-ocr' };
}

async function readOnce() {
  const machine = activeHandMachine;
  const el = source();
  if (!machine || !el || busy) return;
  syncHand(machine);
  const now = performance.now();
  if (now - lastReadAt < 95) return;
  const manual = Boolean(manualRebindToken && manualRebindToken.generation === machine.handId);
  // Main + suit scanner remain the primary board path. During manual recalibration
  // this lane is deliberately forced awake so a stale river can be rebound to the
  // board physically visible right now, including a confirmed zero-card preflop.
  const expected = machine.state.street === 'flop' ? 3 : machine.state.street === 'turn' ? 4 : machine.state.street === 'river' ? 5 : 0;
  if (!manual && expected && machine.state.board?.length === expected && machine.state.board.every((c) => c?.rank)) return;

  lastReadAt = now;
  const frame = frameOf(el);
  if (!frame) return;
  busy = true;
  const t0 = performance.now();
  const handId = machine.handId;
  try {
    if (!layout || now - lastGeomAt > 450) {
      const next = detectFelt(frame);
      if (next) {
        felt = stabilizeFelt(felt, next);
        layout = layoutFromFelt(felt);
        lastGeomAt = now;
      }
    }
    if (!layout || machine.handId !== handId) return;

    const crops = layout.boardSlots.map((slot, i) => cropCanvas(frame.canvas, slot, 112, scratch[i]));
    const scores = crops.map((c) => cardPresenceScore(c.data, c.w, c.h));
    const count = boardCountFromScores(scores, 0.27);

    if (manual && count === 0) {
      manualZeroHits++;
      diagnostics.manualZeroHits = manualZeroHits;
      if (manualZeroHits >= 3 && machine.setBoard([], handId, { rebindToken: manualRebindToken, now })) {
        diagnostics.commits++;
        diagnostics.manualRebinds++;
        manualRebindToken = null;
        manualZeroHits = 0;
        diagnostics.manualZeroHits = 0;
      }
      return;
    }

    manualZeroHits = 0;
    diagnostics.manualZeroHits = 0;
    if (![3, 4, 5].includes(count)) return;

    const cards = [];
    for (let i = 0; i < count; i++) cards.push(await rankCard(crops[i]));
    if (machine.handId !== handId || cards.some((c) => !c?.rank)) return;

    const stable = consensus.observe(cards, { handId, now: performance.now() });
    diagnostics.consensus = `${stable.confirmedCount}/${count}`;
    if (!stable.ready) return;
    const options = manual ? { rebindToken: manualRebindToken, now: performance.now() } : {};
    if (machine.setBoard(stable.cards, handId, options)) {
      diagnostics.commits++;
      if (manual) {
        diagnostics.manualRebinds++;
        manualRebindToken = null;
      }
    }
    diagnostics.reads++;
    diagnostics.lastError = null;
  } catch (e) {
    diagnostics.lastError = e?.message || 'board-refiner-r14-failed';
  } finally {
    diagnostics.lastMs = performance.now() - t0;
    busy = false;
  }
}

function tick() {
  syncHand(activeHandMachine);
  if (manualRebindToken) {
    void readOnce();
    return;
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => void readOnce(), { timeout: 160 });
  else void readOnce();
}

if (typeof window !== 'undefined') {
  window.addEventListener('prc:recalibrate', (event) => {
    const token = event?.detail?.token || null;
    if (!token || token.generation !== activeHandMachine?.handId) return;
    manualRebindToken = token;
    manualZeroHits = 0;
    diagnostics.manualZeroHits = 0;
    consensus.resetHand(activeHandMachine.handId);
    felt = null;
    layout = null;
    lastGeomAt = 0;
    lastReadAt = 0;
  });
}

setInterval(tick, 70);
setTimeout(tick, 120);

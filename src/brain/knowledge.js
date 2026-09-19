import { evaluateHand, boardTexture, drawAnalysis } from './cards.js';
import { parseChips, parseBlinds, potOdds, effectiveDepthBB, spr, round1 } from './math.js';
import { playerMetrics, cautiousPlayerLabel } from './player-model.js';
import { streetFromBoard, heroWasPreflopAggressor } from './action-ledger.js';

const uniq = (xs) => [...new Set((xs || []).filter(Boolean))];

function currentStreetActions(ledger, street) {
  return (ledger?.actions || []).filter((a) => a?.street === street);
}

function lastAggressiveAction(actions) {
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    if (['BET', 'RAISE', 'ALLIN'].includes(actions[i]?.action)) return actions[i];
  }
  return null;
}

function actorRead(store, actor) {
  if (!actor || !store?.players?.[actor]) return null;
  const profile = store.players[actor];
  const metrics = playerMetrics(profile);
  const label = cautiousPlayerLabel(profile);
  return { actor, metrics, label: label?.label ?? 'SEM AMOSTRA', confidence: label?.confidence ?? 'baixa' };
}

function provisionalSummary(rows=[],street){
  return (Array.isArray(rows)?rows:[])
    .filter((c)=>c && c.status==='provisional' && (!street || !c.street || c.street===street))
    .slice(-20)
    .map((c)=>({
      actor:c.actor??null,seatId:c.seatId??null,action:c.action??null,
      amount:c.amount??null,confidence:c.confidence??null,source:c.source??null,
      sovereign:false,status:'provisional',capturedAt:c.capturedAt??null,
    }));
}

export function buildBrainKnowledge(state = {}, { ledger = null, profiles = null, captureCandidates = [] } = {}) {
  const street = streetFromBoard(state.board || []);
  const streetActions = currentStreetActions(ledger, street);
  const lastAggression = lastAggressiveAction(streetActions);
  const heroPfa = heroWasPreflopAggressor(ledger);
  const odds = potOdds(state.pot, state.toCall);
  const sprRead = spr(state.pot, state.heroStack, state.effectiveStack);
  const depthBB = effectiveDepthBB(state.heroStack, state.effectiveStack, state.blinds);
  const blinds = parseBlinds(state.blinds);
  const hand = street === 'preflop' ? null : evaluateHand(state.heroCards, state.board);
  const texture = street === 'preflop' ? null : boardTexture(state.board);
  const draws = street === 'preflop' ? null : drawAnalysis(state.heroCards, state.board);
  const activePlayers = Number.isFinite(state.activePlayers) ? state.activePlayers : (Number.isFinite(state.players) ? state.players : null);
  const facingBet = (state.legalActions || []).includes('CALL') && !(state.legalActions || []).includes('CHECK');
  const actors = uniq([...(ledger?.playersSeen || []), ...(state.seats || []).map((s) => s?.name || s?.player || s?.nick || s?.nickname)]);
  const playerReads = actors.map((actor) => actorRead(profiles, actor)).filter(Boolean);
  const provisionalObserved = provisionalSummary(captureCandidates,street);

  const missing = [];
  if (!Array.isArray(state.heroCards) || state.heroCards.length !== 2) missing.push('heroCards');
  if (!Array.isArray(state.legalActions) || !state.legalActions.length) missing.push('legalActions');
  if (!state.heroPosition) missing.push('heroPosition');
  if (!state.blinds) missing.push('blinds');
  if (state.heroStack == null) missing.push('heroStack');
  if (!ledger?.actions?.length) missing.push('actionHistory');
  if (activePlayers == null) missing.push('activePlayers');
  if (street !== 'preflop' && state.pot == null) missing.push('pot');

  return {
    version: 'brain-knowledge-v1.1',
    street,
    hero: {
      cards: Array.isArray(state.heroCards) ? state.heroCards : [],
      position: state.heroPosition ?? null,
      stack: parseChips(state.heroStack),
      effectiveStack: parseChips(state.effectiveStack),
      effectiveDepthBB: round1(depthBB),
      wasPreflopAggressor: heroPfa,
    },
    table: {
      blinds,
      players: Number.isFinite(state.players) ? state.players : null,
      activePlayers,
      multiway: activePlayers != null ? activePlayers > 2 : null,
      pot: parseChips(state.pot),
      toCall: parseChips(state.toCall),
      legalActions: Array.isArray(state.legalActions) ? [...state.legalActions] : [],
    },
    math: {
      requiredEquityPct: round1(odds?.requiredEquity ?? null),
      finalPotIfCall: odds?.finalPot ?? null,
      spr: round1(sprRead?.value ?? null),
      sprRegime: sprRead?.regime ?? null,
    },
    line: {
      preflopAggressor: ledger?.preflopAggressor ?? null,
      lastAggressor: ledger?.lastAggressor ?? null,
      currentStreetLastAggression: lastAggression ? {
        actor: lastAggression.actor,
        action: lastAggression.action,
        amount: lastAggression.amount ?? null,
        toAmount: lastAggression.toAmount ?? null,
      } : null,
      facingBet,
      actionCount: ledger?.actions?.length ?? 0,
      currentStreetActions: streetActions.map((a) => ({ actor: a.actor, action: a.action, amount: a.amount ?? null, toAmount: a.toAmount ?? null })),
      // Fast local reads are visible to audit/UI but remain non-sovereign until the
      // authoritative ledger confirms them. Strategy modules must not silently
      // promote these rows to confirmed history.
      provisionalObserved,
    },
    postflop: street === 'preflop' ? null : {
      hand: hand ? { name: hand.name, tier: hand.tier, relative: hand.relative } : null,
      texture,
      draws,
    },
    playerReads,
    completeness: {
      missing,
      completeForDecision: missing.length === 0,
      hasLineContext: (ledger?.actions?.length ?? 0) > 0,
      hasProvisionalLineEvidence: provisionalObserved.length > 0,
      hasPlayerSamples: playerReads.some((r) => (r.metrics?.hands ?? 0) >= 30),
    },
  };
}

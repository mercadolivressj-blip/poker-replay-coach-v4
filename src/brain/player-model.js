const pct = (n,d) => d > 0 ? Math.round((n / d) * 1000) / 10 : null;
const aggressive = (a) => ['BET','RAISE','ALLIN'].includes(a);

export function createPlayerProfiles() {
  return { version:'player-model-v1', players:{} };
}

function ensure(store, actor) {
  if (!store.players[actor]) {
    store.players[actor] = {
      actor,
      hands:0,
      vpipHands:0,
      pfrHands:0,
      threeBetHands:0,
      postflopAggressive:0,
      postflopCalls:0,
      postflopChecks:0,
      postflopFolds:0,
      showdowns:0,
      lastHandId:null,
    };
  }
  return store.players[actor];
}

export function finalizeHandIntoProfiles(storeInput, ledger, { handId = ledger?.handId ?? null } = {}) {
  const store = storeInput && storeInput.players ? {
    ...storeInput,
    players:Object.fromEntries(Object.entries(storeInput.players).map(([k,v]) => [k,{...v}]))
  } : createPlayerProfiles();
  const actions = ledger?.actions || [];
  const actors = [...new Set(actions.map((a) => a.actor).filter(Boolean))];
  const pre = actions.filter((a) => a.street === 'preflop');
  const preAggressive = pre.filter((a) => aggressive(a.action));

  for (const actor of actors) {
    const p = ensure(store, actor);
    if (handId != null && p.lastHandId === handId) continue;
    p.hands += 1;
    p.lastHandId = handId;
    const mine = actions.filter((a) => a.actor === actor);
    const minePre = mine.filter((a) => a.street === 'preflop');
    const vpip = minePre.some((a) => ['CALL','BET','RAISE','ALLIN'].includes(a.action));
    const pfr = minePre.some((a) => ['RAISE','BET','ALLIN'].includes(a.action));
    if (vpip) p.vpipHands += 1;
    if (pfr) p.pfrHands += 1;

    const actorAgg = preAggressive.findIndex((a) => a.actor === actor);
    if (actorAgg > 0 && preAggressive.slice(0,actorAgg).some((a) => a.actor !== actor)) p.threeBetHands += 1;

    for (const a of mine.filter((x) => x.street !== 'preflop')) {
      if (aggressive(a.action)) p.postflopAggressive += 1;
      else if (a.action === 'CALL') p.postflopCalls += 1;
      else if (a.action === 'CHECK') p.postflopChecks += 1;
      else if (a.action === 'FOLD') p.postflopFolds += 1;
    }
  }
  return store;
}

export function playerMetrics(profile) {
  if (!profile) return null;
  const passive = profile.postflopCalls || 0;
  const aggr = profile.postflopAggressive || 0;
  return {
    actor:profile.actor,
    hands:profile.hands,
    vpip:pct(profile.vpipHands,profile.hands),
    pfr:pct(profile.pfrHands,profile.hands),
    threeBet:pct(profile.threeBetHands,profile.hands),
    aggressionFactor: passive > 0 ? Math.round((aggr / passive) * 100) / 100 : (aggr > 0 ? Infinity : null),
    sample: profile.hands < 10 ? 'tiny' : profile.hands < 30 ? 'small' : profile.hands < 100 ? 'medium' : 'large',
  };
}

export function cautiousPlayerLabel(profile) {
  const m = playerMetrics(profile);
  if (!m || m.hands < 30) return { label:'SEM AMOSTRA', confidence:'baixa', metrics:m };
  let label = 'REGULAR / INDEFINIDO';
  if (m.vpip != null && m.pfr != null) {
    if (m.vpip >= 35 && m.pfr <= 15) label = 'LOOSE-PASSIVO';
    else if (m.vpip >= 30 && m.pfr >= 22) label = 'LOOSE-AGRESSIVO';
    else if (m.vpip <= 20 && m.pfr <= 16) label = 'TIGHT';
    else if (m.vpip >= 20 && m.vpip <= 30 && m.pfr >= 16) label = 'REGULAR';
  }
  return { label, confidence:m.hands >= 100 ? 'media' : 'baixa', metrics:m };
}

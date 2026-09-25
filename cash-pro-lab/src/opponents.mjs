export const ARCHETYPES = Object.freeze({
  BALANCED_REG: Object.freeze({
    id: 'BALANCED_REG', vpip: 0.27, pfr: 0.23, threeBet: 0.095,
    flopCbet: 0.66, turnBarrel: 0.48, riverBarrel: 0.38,
    checkRaise: 0.11, riverBluff: 0.27, overbetRiver: 0.12,
    foldToFlopBet: 0.39, foldToTurnBet: 0.43, foldToRiverBet: 0.47,
    thinValueRiver: 0.19
  }),
  TIGHT_REG: Object.freeze({
    id: 'TIGHT_REG', vpip: 0.21, pfr: 0.18, threeBet: 0.075,
    flopCbet: 0.61, turnBarrel: 0.43, riverBarrel: 0.30,
    checkRaise: 0.085, riverBluff: 0.18, overbetRiver: 0.07,
    foldToFlopBet: 0.45, foldToTurnBet: 0.49, foldToRiverBet: 0.53,
    thinValueRiver: 0.13
  }),
  AGGRO_REG: Object.freeze({
    id: 'AGGRO_REG', vpip: 0.31, pfr: 0.27, threeBet: 0.125,
    flopCbet: 0.72, turnBarrel: 0.57, riverBarrel: 0.47,
    checkRaise: 0.145, riverBluff: 0.35, overbetRiver: 0.19,
    foldToFlopBet: 0.35, foldToTurnBet: 0.38, foldToRiverBet: 0.42,
    thinValueRiver: 0.23
  }),
  LAG_REG: Object.freeze({
    id: 'LAG_REG', vpip: 0.36, pfr: 0.31, threeBet: 0.135,
    flopCbet: 0.69, turnBarrel: 0.54, riverBarrel: 0.45,
    checkRaise: 0.13, riverBluff: 0.33, overbetRiver: 0.17,
    foldToFlopBet: 0.33, foldToTurnBet: 0.37, foldToRiverBet: 0.40,
    thinValueRiver: 0.25
  }),
  TRICKY_REG: Object.freeze({
    id: 'TRICKY_REG', vpip: 0.29, pfr: 0.24, threeBet: 0.10,
    flopCbet: 0.57, turnBarrel: 0.44, riverBarrel: 0.41,
    checkRaise: 0.16, riverBluff: 0.30, overbetRiver: 0.16,
    foldToFlopBet: 0.38, foldToTurnBet: 0.42, foldToRiverBet: 0.44,
    thinValueRiver: 0.21
  }),
  CALLING_STATION: Object.freeze({
    id: 'CALLING_STATION', vpip: 0.43, pfr: 0.13, threeBet: 0.035,
    flopCbet: 0.43, turnBarrel: 0.31, riverBarrel: 0.22,
    checkRaise: 0.05, riverBluff: 0.12, overbetRiver: 0.035,
    foldToFlopBet: 0.22, foldToTurnBet: 0.25, foldToRiverBet: 0.30,
    thinValueRiver: 0.28
  }),
  NIT: Object.freeze({
    id: 'NIT', vpip: 0.16, pfr: 0.13, threeBet: 0.045,
    flopCbet: 0.54, turnBarrel: 0.36, riverBarrel: 0.24,
    checkRaise: 0.055, riverBluff: 0.10, overbetRiver: 0.03,
    foldToFlopBet: 0.50, foldToTurnBet: 0.55, foldToRiverBet: 0.60,
    thinValueRiver: 0.08
  })
});

export const POPULATION_PRIOR = Object.freeze({
  vpip: 0.27, pfr: 0.22, threeBet: 0.09,
  flopCbet: 0.62, turnBarrel: 0.46, riverBarrel: 0.35,
  checkRaise: 0.10, riverBluff: 0.24, overbetRiver: 0.10,
  foldToFlopBet: 0.40, foldToTurnBet: 0.44, foldToRiverBet: 0.48,
  thinValueRiver: 0.18
});

export function getArchetype(id){
  const x = ARCHETYPES[String(id || '').toUpperCase()];
  if(!x) throw new Error(`unknown_archetype:${id}`);
  return x;
}

export function statNames(){
  return Object.keys(POPULATION_PRIOR);
}

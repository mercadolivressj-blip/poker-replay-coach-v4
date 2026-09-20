// Browser-safe postflop guard for standalone runtime.
// Intentionally has ZERO imports so it can be loaded directly by the browser.
// Conservative: free check is allowed; facing a bet returns no advice rather than inventing a call/fold.
export function postflopPolicyV4Decision(state, context = {}) {
  const legal = new Set(Array.isArray(state?.legalActions) ? state.legalActions : []);
  const board = Array.isArray(state?.board) ? state.board : [];
  if (board.length < 3) {
    return { decision: null, engine: 'POSTFLOP SAFE', reason: 'Ainda não estamos no pós-flop.' };
  }
  if (legal.has('CHECK') && !legal.has('CALL')) {
    return {
      decision: 'PASSAR',
      engine: 'POSTFLOP SAFE · CHECK GRATUITO',
      reason: 'Sem aposta pendente e CHECK confirmado entre os botões atuais. Linha segura até a Policy V4 completa voltar ao browser.'
    };
  }
  return {
    decision: null,
    engine: 'POSTFLOP SAFE · SEM DICA',
    reason: 'Há decisão paga/agressiva no pós-flop. Esta build prefere SEM DICA a inventar call/fold enquanto a Policy V4 completa não está disponível no browser.'
  };
}

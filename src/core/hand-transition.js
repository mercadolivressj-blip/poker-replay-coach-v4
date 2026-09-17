// HAND TRANSITION V1 — lives outside Lovable. It consumes observations only.
// Goal: clear the old hand fast without changing the frozen vision reader.
export function createHandTransitionV1() {
  let absentVotes = 0;
  let candidate = '';
  let candidateVotes = 0;

  const resetCandidate = () => { candidate = ''; candidateVotes = 0; };

  return {
    observeHero({ heroCards = [], heroPresence = null, confidence = 0 }, currentHero = []) {
      const currentKey = currentHero.join(' ');
      if (heroPresence === 'absent') {
        absentVotes += 1;
        resetCandidate();
        if (absentVotes >= 2 && currentHero.length === 2) {
          absentVotes = 0;
          return { type: 'HAND_ENDED', clear: true, reason: 'hero region absent twice' };
        }
        return { type: 'NO_CHANGE' };
      }

      if (heroPresence !== 'present' || heroCards.length !== 2) return { type: 'NO_CHANGE' };
      absentVotes = 0;
      const key = heroCards.join(' ');
      if (key === currentKey) { resetCandidate(); return { type: 'NO_CHANGE' }; }

      if (candidate === key) candidateVotes += 1;
      else { candidate = key; candidateVotes = 1; }

      // First ever hand may fast-lock at high confidence. A transition between
      // two different hands always requires 2 matching observations.
      const need = currentHero.length === 0 && confidence >= 0.9 ? 1 : 2;
      if (candidateVotes >= need) {
        const next = [...heroCards];
        resetCandidate();
        return {
          type: currentHero.length ? 'NEW_HAND' : 'HAND_STARTED',
          clear: currentHero.length > 0,
          heroCards: next,
          reason: currentHero.length ? 'new hero cards confirmed twice' : 'first hero hand confirmed',
        };
      }
      return { type: 'NO_CHANGE' };
    },
    reset() { absentVotes = 0; resetCandidate(); },
  };
}

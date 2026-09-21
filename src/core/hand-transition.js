// HAND TRANSITION V1 — consumes observations only; no UI/network coupling.
// Conservative rule: transient Hero disappearance suspends the current hand.
// A new hand requires different confirmed hole cards, or the same cards with a
// rotated dealer button. This prevents replay animation/dropout false splits.
export function createHandTransitionV1() {
  let candidate = '';
  let candidateDealer = null;
  let candidateVotes = 0;
  let suspended = false;
  let confirmedDealer = null;

  const resetCandidate = () => { candidate = ''; candidateDealer = null; candidateVotes = 0; };

  return {
    observeHero({ heroCards = [], heroPresence = null, confidence = 0, dealerSeat = null }, currentHero = []) {
      const currentKey = currentHero.join(' ');

      if (heroPresence === 'absent') {
        suspended = currentHero.length === 2 || suspended;
        resetCandidate();
        return { type: suspended ? 'HAND_SUSPENDED' : 'NO_CHANGE', clear: false, reason: suspended ? 'hero temporarily absent; identity preserved' : undefined };
      }

      if (heroPresence !== 'present' || heroCards.length !== 2) return { type: 'NO_CHANGE' };
      const key = heroCards.join(' ');

      if (currentHero.length === 0) {
        if (confidence < 0.9) return { type: 'NO_CHANGE' };
        confirmedDealer = dealerSeat || confirmedDealer;
        suspended = false;
        resetCandidate();
        return { type: 'HAND_STARTED', clear: false, heroCards: [...heroCards], dealerSeat: confirmedDealer, reason: 'first hero hand confirmed' };
      }

      const dealerRotated = Boolean(dealerSeat && confirmedDealer && dealerSeat !== confirmedDealer);
      if (key === currentKey && !dealerRotated) {
        const wasSuspended = suspended;
        suspended = false;
        if (dealerSeat) confirmedDealer = dealerSeat;
        resetCandidate();
        return wasSuspended
          ? { type: 'HAND_RESUMED', clear: false, heroCards: [...heroCards], dealerSeat: confirmedDealer, reason: 'same hero cards and dealer after visual gap' }
          : { type: 'NO_CHANGE' };
      }

      const dealerKey = dealerSeat || '';
      if (candidate === key && candidateDealer === dealerKey) candidateVotes += 1;
      else { candidate = key; candidateDealer = dealerKey; candidateVotes = 1; }

      // Every transition requires two matching observations. Same-card
      // consecutive hands are allowed only when the dealer button rotated.
      if (candidateVotes >= 2 && (key !== currentKey || dealerRotated)) {
        const next = [...heroCards];
        confirmedDealer = dealerSeat || confirmedDealer;
        suspended = false;
        resetCandidate();
        return {
          type: 'NEW_HAND',
          clear: true,
          heroCards: next,
          dealerSeat: confirmedDealer,
          reason: key !== currentKey ? 'new hero cards confirmed twice' : 'dealer rotated with same hero cards',
        };
      }
      return { type: 'NO_CHANGE' };
    },
    reset() { resetCandidate(); suspended = false; confirmedDealer = null; },
  };
}

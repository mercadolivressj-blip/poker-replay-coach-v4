/** Conservative merge for the background Vision Teacher. */
export function reconcileTeacher(localCards = [], visionCards = []) {
  if (!Array.isArray(visionCards) || !visionCards.length) return { accepted: false, reason: 'empty', cards: [], learn: [] };
  if (localCards.length && localCards.length !== visionCards.length) return { accepted: false, reason: 'count', cards: [], learn: [] };
  for (let i = 0; i < visionCards.length; i++) {
    const local = localCards[i] || {}, vision = visionCards[i] || {};
    if (local.rank && vision.rank && local.rank !== vision.rank) return { accepted: false, reason: `rank-conflict-${i}`, cards: [], learn: [] };
  }
  const cards = visionCards.map((vision, i) => {
    const local = localCards[i] || {};
    const rank = local.rank || vision.rank || null;
    const suit = vision.suit ?? local.suit ?? null;
    const confidence = Math.max(Number(local.confidence) || 0, Number(vision.confidence) || 0);
    return { ...local, ...vision, rank, suit, confidence, source: local.rank ? 'vision-confirmed' : 'vision-filled' };
  });
  const learn = cards.map((c, i) => ({ index: i, rank: c.rank, weight: localCards[i]?.rank ? 1 : 0.55 }));
  return { accepted: cards.every((c) => c.rank), reason: 'ok', cards, learn };
}

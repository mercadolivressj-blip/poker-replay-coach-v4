/**
 * Merge for the frozen Gemini eyes.
 *
 * Local templates/OCR are fast hints and lifecycle helpers. Once the VisionTeacher has
 * accepted a complete high-confidence Gemini read (including its conflict-consensus guard),
 * Gemini is the card authority. This is intentional: a wrong local rank must not block the
 * stronger card-by-card reader from correcting it.
 */
export function reconcileTeacher(localCards = [], visionCards = []) {
  if (!Array.isArray(visionCards) || !visionCards.length)
    return { accepted: false, reason: 'empty', cards: [], learn: [] };
  if (localCards.length && localCards.length !== visionCards.length)
    return { accepted: false, reason: 'count', cards: [], learn: [] };

  const complete = visionCards.every((c) => c?.rank && Number(c?.confidence) >= 0.9);
  if (!complete) return { accepted: false, reason: 'vision-not-strong', cards: [], learn: [] };

  const cards = visionCards.map((vision, i) => {
    const local = localCards[i] || {};
    return {
      ...local,
      ...vision,
      rank: vision.rank,
      suit: vision.suit ?? null,
      confidence: Number(vision.confidence) || 0,
      source: local.rank === vision.rank ? 'gemini-confirmed' : 'gemini-corrected',
    };
  });
  const learn = cards.map((c, i) => ({
    index: i,
    rank: c.rank,
    weight: localCards[i]?.rank === c.rank ? 1 : 0.45,
  }));
  return { accepted: true, reason: 'ok', cards, learn };
}

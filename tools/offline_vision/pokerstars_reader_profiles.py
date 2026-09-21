from __future__ import annotations
from dataclasses import dataclass
from card_templates import CardTemplates
from pokerstars_offline import NumericTemplates


@dataclass
class PokerStarsReaderProfiles:
    """Context-separated fixed-theme reader banks.

    PokerStars renders Hero cards, board cards, stacks, pots and commitments at
    different sizes/antialiasing/brightness. Sharing one bank across contexts
    caused the independent-session 6/8, Q/9 and small-pot 0/8 failures.
    """
    hero_cards: CardTemplates
    board_cards: CardTemplates
    stack: NumericTemplates
    pot: NumericTemplates
    commitment: NumericTemplates

    @classmethod
    def create(cls):
        return cls(
            hero_cards=CardTemplates(rank_min=.50, suit_min=.46, rank_margin=.008, suit_margin=.018),
            board_cards=CardTemplates(rank_min=.48, suit_min=.44, rank_margin=.012, suit_margin=.008),
            stack=NumericTemplates(),
            pot=NumericTemplates(),
            commitment=NumericTemplates(),
        )

    def add_hero_card(self, roi, card):
        self.hero_cards.add(roi, card)

    def add_board_card(self, roi, card):
        # The branded board Ace of Spades polluted the ordinary c/s suit margin
        # in the first session. Its rank remains useful; its suit does not.
        self.board_cards.add(roi, card, include_suit=(card != 'As'))

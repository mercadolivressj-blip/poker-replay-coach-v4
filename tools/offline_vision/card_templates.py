import cv2
import numpy as np
from pokerstars_offline import norm_gray, _contours


def _glyph(roi, kind):
    # Fixed PokerStars cards: rank lives at y≈3..23, suit at y≈27..42.
    # Isolate those components instead of normalizing rank fragments + suit
    # together, which made diamonds/spades unstable across hands.
    z=roi[:min(43,roi.shape[0]),:min(22,roi.shape[1])]
    hsv=cv2.cvtColor(z,cv2.COLOR_BGR2HSV)
    gray=cv2.cvtColor(z,cv2.COLOR_BGR2GRAY)
    mask=(((gray<175)|(hsv[:,:,1]>85)) & (hsv[:,:,2]<245)).astype(np.uint8)*255
    mask[:,0:3]=0; mask[:2,:]=0; mask[-2:,:]=0; mask[:,-2:]=0
    out=np.zeros_like(mask); chosen=[]
    for c in _contours(mask):
        x,y,w,h=cv2.boundingRect(c); area=int(cv2.countNonZero(mask[y:y+h,x:x+w]))
        if area<4: continue
        if kind=='rank':
            if y<=8 and h>=10 and w<=16: chosen.append(c)
        else:
            if x<=18 and y>=24 and h>=8 and w<=16: chosen.append(c)
    if not chosen: return np.zeros((32,24),np.uint8)
    # Rank 10 is two glyph components. Preserve source pixels/holes instead of
    # filling contours: Q/8 and black-suit distinctions depend on the interior.
    for c in chosen:
        x,y,w,h=cv2.boundingRect(c)
        out[y:y+h,x:x+w]=np.maximum(out[y:y+h,x:x+w],mask[y:y+h,x:x+w])
    return norm_gray(out,(24,32))


def _score(a,b):
    a=a.astype(np.float32)/255; b=b.astype(np.float32)/255
    return float(np.minimum(a,b).sum()/(np.maximum(a,b).sum()+1e-6))


class CardTemplates:
    """Context-local PokerStars rank/suit template matcher.

    The caller should keep Hero and board banks separate. `include_suit=False`
    exists for branded/special card renderings whose suit glyph is not a clean
    representative for the normal suit bank (notably the board Ace of Spades in
    this theme).
    """
    def __init__(self, rank_min=0.50, suit_min=0.46, rank_margin=0.025, suit_margin=0.018):
        self.ranks={}; self.suits={}
        self.rank_min=rank_min; self.suit_min=suit_min
        self.rank_margin=rank_margin; self.suit_margin=suit_margin

    def add(self, roi, card, include_suit=True):
        rank,suit=card[0],card[1]
        self.ranks.setdefault(rank,[]).append(_glyph(roi,'rank'))
        if include_suit:
            self.suits.setdefault(suit,[]).append(_glyph(roi,'suit'))

    def coverage(self):
        return {'ranks':sorted(self.ranks),'suits':sorted(self.suits)}

    def _classify(self, patch, bank, minimum, margin):
        per_label=[]
        for label,templates in bank.items():
            per_label.append((label,max((_score(patch,t) for t in templates),default=-1.0)))
        per_label.sort(key=lambda x:x[1],reverse=True)
        if not per_label: return None,0.0,0.0
        label,score=per_label[0]; second=per_label[1][1] if len(per_label)>1 else 0.0
        gap=score-second
        if score<minimum or gap<margin: return None,score,gap
        return label,score,gap

    def read(self, roi):
        rank,rs,rm=self._classify(_glyph(roi,'rank'),self.ranks,self.rank_min,self.rank_margin)
        suit,ss,sm=self._classify(_glyph(roi,'suit'),self.suits,self.suit_min,self.suit_margin)
        card=rank+suit if rank and suit else None
        return card,min(rs,ss),{'rankScore':rs,'suitScore':ss,'rankMargin':rm,'suitMargin':sm}

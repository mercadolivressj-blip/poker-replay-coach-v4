import cv2
import numpy as np
from pokerstars_offline import norm_gray, _contours


def _glyph(roi, kind):
    h,w=roi.shape[:2]
    if kind=='rank': z=roi[0:min(h,24),0:min(w,18)]
    else: z=roi[min(h,16):min(h,43),0:min(w,18)]
    hsv=cv2.cvtColor(z,cv2.COLOR_BGR2HSV)
    gray=cv2.cvtColor(z,cv2.COLOR_BGR2GRAY)
    mask=(((gray<175)|(hsv[:,:,1]>85)) & (hsv[:,:,2]<245)).astype(np.uint8)*255
    out=np.zeros_like(mask)
    # Avoid connectedComponentsWithStats: long offline runs showed native crashes
    # on some OpenCV builds. Contours are sufficient for these tiny fixed glyphs.
    for c in _contours(mask):
        x,y,ww,hh=cv2.boundingRect(c)
        area=int(cv2.countNonZero(mask[y:y+hh,x:x+ww]))
        if area>=4 and hh>=3: cv2.drawContours(out,[c],-1,255,-1)
    return norm_gray(out,(24,32))


def _score(a,b):
    a=a.astype(np.float32)/255; b=b.astype(np.float32)/255
    return float(np.minimum(a,b).sum()/(np.maximum(a,b).sum()+1e-6))


class CardTemplates:
    """Fixed PokerStars rank/suit matcher trained from labeled video frames.

    A reader must beat both an absolute score and a distinct-label margin.
    Otherwise it abstains. That makes `count=5, decode=4` a blocked snapshot,
    never an excuse to invent the missing fifth card.
    """
    def __init__(self, rank_min=0.50, suit_min=0.46, rank_margin=0.025, suit_margin=0.018):
        self.ranks={}; self.suits={}
        self.rank_min=rank_min; self.suit_min=suit_min
        self.rank_margin=rank_margin; self.suit_margin=suit_margin

    def add(self, roi, card):
        rank,suit=card[0],card[1]
        self.ranks.setdefault(rank,[]).append(_glyph(roi,'rank'))
        self.suits.setdefault(suit,[]).append(_glyph(roi,'suit'))

    def coverage(self):
        return {'ranks':sorted(self.ranks),'suits':sorted(self.suits)}

    def _classify(self, patch, bank, minimum, margin):
        per_label=[]
        for label,templates in bank.items():
            best=max((_score(patch,t) for t in templates),default=-1.0)
            per_label.append((label,best))
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

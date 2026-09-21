import cv2
import numpy as np
from pokerstars_offline import norm_gray


def _glyph(roi, kind):
    h,w=roi.shape[:2]
    if kind=='rank': z=roi[0:min(h,24),0:min(w,18)]
    else: z=roi[min(h,16):min(h,43),0:min(w,18)]
    hsv=cv2.cvtColor(z,cv2.COLOR_BGR2HSV)
    gray=cv2.cvtColor(z,cv2.COLOR_BGR2GRAY)
    mask=(((gray<175)|(hsv[:,:,1]>85)) & (hsv[:,:,2]<245)).astype(np.uint8)*255
    n,lab,stats,_=cv2.connectedComponentsWithStats(mask,8)
    out=np.zeros_like(mask)
    for i in range(1,n):
        x,y,ww,hh,area=map(int,stats[i])
        if area>=4 and hh>=3: out[lab==i]=255
    return norm_gray(out,(24,32))


def _score(a,b):
    a=a.astype(np.float32)/255; b=b.astype(np.float32)/255
    return float(np.minimum(a,b).sum()/(np.maximum(a,b).sum()+1e-6))


class CardTemplates:
    """Fixed PokerStars rank/suit matcher trained from labeled video frames."""
    def __init__(self):
        self.ranks={}
        self.suits={}

    def add(self, roi, card):
        rank,suit=card[0],card[1]
        self.ranks.setdefault(rank,[]).append(_glyph(roi,'rank'))
        self.suits.setdefault(suit,[]).append(_glyph(roi,'suit'))

    def _classify(self, patch, bank):
        best=(None,-1.0)
        for label,templates in bank.items():
            for template in templates:
                score=_score(patch,template)
                if score>best[1]: best=(label,score)
        return best

    def read(self, roi):
        rank,rs=self._classify(_glyph(roi,'rank'),self.ranks)
        suit,ss=self._classify(_glyph(roi,'suit'),self.suits)
        return (rank+suit if rank and suit else None, min(rs,ss))

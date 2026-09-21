from __future__ import annotations
import cv2
import numpy as np
from dataclasses import dataclass

BASE_W, BASE_H = 1280, 720
CLOCKWISE_SEATS = ['top','rt','rb','hero','lb','lt']

DEFAULT_CAL = {
  'heroCards': [(578,436,60,43),(641,436,61,43)],
  'board': [(476,236,60,85),(543,236,60,85),(610,236,60,85),(677,236,60,85),(744,236,60,85)],
  'potValue': (640,212,70,25),
  'heroStackValue': (650,510,85,26),
  'heroButtons': (630,615,590,85),
  'table': (255,135,760,335),
  'seats': {
    'hero': {'panel':(535,474,240,70),'cards':(570,430,140,56),'stack':(620,505,120,34),'commit':(565,386,150,42)},
    'lb': {'panel':(165,350,205,80),'cards':(200,318,140,66),'stack':(195,382,125,35),'commit':(360,340,135,48)},
    'lt': {'panel':(195,138,205,72),'cards':(235,105,135,62),'stack':(220,177,125,33),'commit':(370,170,135,48)},
    'top': {'panel':(540,75,205,72),'cards':(575,45,135,66),'stack':(565,111,125,33),'commit':(635,138,145,46)},
    'rt': {'panel':(880,138,205,72),'cards':(915,105,140,65),'stack':(955,177,125,33),'commit':(760,176,145,50)},
    'rb': {'panel':(910,350,205,80),'cards':(945,318,140,66),'stack':(990,383,125,35),'commit':(800,340,145,50)},
  }
}

def crop(img, r):
    x,y,w,h = r
    return img[y:y+h, x:x+w]

def _contours(mask):
    found = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return found[0] if len(found) == 2 else found[1]

def norm_gray(binary_crop, out=(24,32)):
    ys,xs = np.where(binary_crop>0)
    if len(xs)==0: return np.zeros((out[1],out[0]),np.uint8)
    c=binary_crop[ys.min():ys.max()+1,xs.min():xs.max()+1]
    scale=min((out[0]-4)/max(1,c.shape[1]),(out[1]-4)/max(1,c.shape[0]))
    rs=cv2.resize(c,(max(1,int(c.shape[1]*scale)),max(1,int(c.shape[0]*scale))),interpolation=cv2.INTER_NEAREST)
    canvas=np.zeros((out[1],out[0]),np.uint8)
    y=(out[1]-rs.shape[0])//2; x=(out[0]-rs.shape[1])//2
    canvas[y:y+rs.shape[0],x:x+rs.shape[1]]=rs
    return canvas

class NumericTemplates:
    """PokerStars numeric reader trained only on labeled fixed ROIs.

    Currency prefixes are never classified as digits. The reader anchors itself
    to the decimal comma and evaluates 1/2/3-integer-digit hypotheses. Ambiguous
    or contaminated reads abstain instead of silently dropping a leading digit.
    """
    def __init__(self): self.bank={str(i):[] for i in range(10)}

    def _bw(self, roi):
        hsv=cv2.cvtColor(roi,cv2.COLOR_BGR2HSV); v=hsv[:,:,2]; sat=hsv[:,:,1]
        med=float(np.median(v)); th=175 if med>45 else 60
        return (((sat<105)&(v>th)).astype(np.uint8))*255

    def _comma_x(self, roi):
        bw=self._bw(roi); H=roi.shape[0]; cand=[]
        for c in _contours(bw):
            x,y,w,h=cv2.boundingRect(c); area=int(cv2.countNonZero(bw[y:y+h,x:x+w]))
            if 1<=w<=6 and 2<=h<=8 and y>=H*0.48 and area>=3: cand.append((x,area,y))
        return max(cand,key=lambda z:z[0])[0] if cand else None

    def _raw_digit_boxes(self, roi):
        bw=self._bw(roi); H=roi.shape[0]; out=[]
        for c in _contours(bw):
            x,y,w,h=cv2.boundingRect(c); ink=int(cv2.countNonZero(bw[y:y+h,x:x+w]))
            if h>=7 and ink>=9 and w<=13 and y<=H-5: out.append((x,y,w,h,ink))
        return sorted(out,key=lambda b:b[0])

    def _digit_groups(self, roi):
        bw=self._bw(roi); out=[]
        for x,y,w,h,ink in self._raw_digit_boxes(roi):
            m=np.zeros_like(bw); m[y:y+h,x:x+w]=bw[y:y+h,x:x+w]
            out.append((x,m,ink))
        return out

    def _fixed_masks(self, roi, integer_digits):
        cx=self._comma_x(roi)
        if cx is None or integer_digits not in (1,2,3): return []
        boxes=[b for b in self._raw_digit_boxes(roi) if b[0]+b[2] <= cx]
        if not boxes: return []
        anchor=boxes[-1]
        style='stack' if anchor[3] >= 13 else 'pot'
        if style=='stack': last=cx-10; pitch=9; dec=[cx+4,cx+14]
        else: last=cx-9; pitch=9; dec=[cx+4,cx+13]
        starts=[last-pitch*(integer_digits-1-i) for i in range(integer_digits)]+dec
        bw=self._bw(roi); masks=[]
        y0=max(0,anchor[1]-2); y1=min(bw.shape[0],anchor[1]+anchor[3]+4)
        for x0 in starts:
            xa=max(0,int(x0)-1); xb=min(bw.shape[1],xa+11); z=bw[y0:y1,xa:xb]; best=None
            for c in _contours(z):
                x,y,w,h=cv2.boundingRect(c); ink=int(cv2.countNonZero(z[y:y+h,x:x+w]))
                if h>=7 and ink>=9 and w<=11 and (best is None or ink>best[0]): best=(ink,x,y,w,h)
            if best is None: return []
            _,x,y,w,h=best; m=np.zeros_like(bw)
            m[y0+y:y0+y+h,xa+x:xa+x+w]=z[y:y+h,x:x+w]
            masks.append(m)
        return masks

    def add_labeled(self, roi, value, profile=None):
        left,right=f'{float(value):.2f}'.split('.'); labels=left+right
        masks=self._fixed_masks(roi,len(left))
        if len(masks)!=len(labels): return False
        for ch,m in zip(labels,masks): self.bank[ch].append(norm_gray(m))
        return True

    def ready(self): return all(self.bank[d] for d in self.bank)

    def classify_digit(self, mask):
        z=norm_gray(mask).astype(np.float32)/255; scores=[]
        for d,temps in self.bank.items():
            best=-1.0
            for t in temps:
                a=t.astype(np.float32)/255
                sc=float(np.sum(np.minimum(a,z))/(np.sum(np.maximum(a,z))+1e-6))
                best=max(best,sc)
            if best>=0: scores.append((d,best))
        scores.sort(key=lambda x:x[1],reverse=True)
        if not scores: return '?',0.0,0.0
        best=scores[0]; second=scores[1][1] if len(scores)>1 else 0.0
        return best[0],best[1],best[1]-second

    def _read_hypothesis(self, roi, integer_digits):
        masks=self._fixed_masks(roi,integer_digits)
        if len(masks)!=integer_digits+2: return None
        chars=[]; scores=[]; margins=[]
        for m in masks:
            d,sc,margin=self.classify_digit(m); chars.append(d); scores.append(sc); margins.append(margin)
        mean=float(np.mean(scores)) if scores else 0.0
        valid=('?' not in chars and min(scores)>=0.43 and mean>=0.50 and min(margins)>=0.012)
        digits=''.join(chars)
        text=digits[:-2]+','+digits[-2:] if len(digits)>=3 else ''
        return {'valid':valid,'digits':digits,'text':text,'mean':mean,'minScore':min(scores) if scores else 0.0,'minMargin':min(margins) if margins else 0.0}

    def read(self, roi, profile=None):
        # Longest independently-valid hypothesis wins. This prevents a weak
        # leading digit from collapsing 40,78 into 0,78 while currency-prefix
        # contamination still fails the same confidence gate.
        valid=[]
        for integer_digits in (1,2,3):
            h=self._read_hypothesis(roi,integer_digits)
            if h and h['valid']: valid.append((integer_digits,h))
        if not valid: return None,0.0,''
        _,h=max(valid,key=lambda x:x[0])
        return float(h['text'].replace(',','.')),h['mean'],h['text']

@dataclass
class SlotPresence:
    present: bool
    white_ratio: float
    dark_ratio: float

def card_face_present(roi):
    hsv=cv2.cvtColor(roi,cv2.COLOR_BGR2HSV); white=((hsv[:,:,1]<65)&(hsv[:,:,2]>170)); wr=float(white.mean())
    gray=cv2.cvtColor(roi,cv2.COLOR_BGR2GRAY); dr=float((gray<55).mean())
    return SlotPresence(wr>0.18,wr,dr)

def board_presence(img, cal=DEFAULT_CAL): return [card_face_present(crop(img,r)) for r in cal['board']]
def hero_presence(img, cal=DEFAULT_CAL): return [card_face_present(crop(img,r)) for r in cal['heroCards']]

def occupied_seat(panel_roi):
    g=cv2.cvtColor(panel_roi,cv2.COLOR_BGR2GRAY)
    return float((g>95).mean())>0.055

def seat_dealt_in(cards_roi, hero=False):
    hsv=cv2.cvtColor(cards_roi,cv2.COLOR_BGR2HSV)
    h,s,v=hsv[:,:,0],hsv[:,:,1],hsv[:,:,2]
    if hero:
        white=((s<65)&(v>170))
        return bool(float(white.mean())>0.18)
    # Opponent backs in this PokerStars theme are red. Detect at hand start and
    # freeze the result; generic blue/white texture was counting empty panels.
    red=(((h<10)|(h>170))&(s>80)&(v>50))
    return bool(float(red.mean())>0.12)

def dealt_seats(img, cal=DEFAULT_CAL):
    out=[]
    for seat,row in cal['seats'].items():
        if seat_dealt_in(crop(img,row['cards']),hero=(seat=='hero')): out.append(seat)
    return out

def dealer_center(img, cal=DEFAULT_CAL):
    x,y,w,h=cal['table']; roi=img[y:y+h,x:x+w]; hsv=cv2.cvtColor(roi,cv2.COLOR_BGR2HSV)
    red=((hsv[:,:,0]<12)|(hsv[:,:,0]>168))&(hsv[:,:,1]>110)&(hsv[:,:,2]>120); white=(hsv[:,:,1]<45)&(hsv[:,:,2]>190)
    mask=((red|white).astype(np.uint8))*255; best=None; board_box=(450-x,215-y,380,125)
    for c in _contours(mask):
        bx,by,bw,bh=cv2.boundingRect(c); area=int(cv2.countNonZero(mask[by:by+bh,bx:bx+bw])); cx=bx+bw/2; cy=by+bh/2
        if area<45 or area>700 or bw<8 or bh<8 or bw>36 or bh>36: continue
        ar=bw/max(1,bh)
        if not 0.55<ar<1.8: continue
        if board_box[0]<=cx<=board_box[0]+board_box[2] and board_box[1]<=cy<=board_box[1]+board_box[3]: continue
        score=area-abs(bw-bh)*3
        if best is None or score>best[0]: best=(score,(int(cx+x),int(cy+y)))
    return best[1] if best else None

SEAT_CENTERS={'hero':(655,510),'lb':(270,390),'lt':(300,170),'top':(640,110),'rt':(980,170),'rb':(1010,390)}
def dealer_seat(img):
    c=dealer_center(img)
    if not c: return None,c
    return min(SEAT_CENTERS,key=lambda s:(SEAT_CENTERS[s][0]-c[0])**2+(SEAT_CENTERS[s][1]-c[1])**2),c

def hero_position_from_dealer(dealer, active):
    active=[s for s in CLOCKWISE_SEATS if s in set(active)]
    if dealer not in active or 'hero' not in active or len(active)<2: return None
    i=active.index(dealer); ordered=active[i:]+active[:i]
    n=len(ordered)
    labels={
      2:['BTN/SB','BB'],
      3:['BTN','SB','BB'],
      4:['BTN','SB','BB','CO'],
      5:['BTN','SB','BB','UTG','CO'],
      6:['BTN','SB','BB','UTG','HJ','CO'],
    }.get(n)
    return labels[ordered.index('hero')] if labels else None

@dataclass
class ButtonState:
    confirmed: bool
    layout: str | None
    actions: tuple
    blue_ratio: float
    green_ratio: float
    orange_ratio: float

def hero_button_state_from_roi(roi, to_call=None):
    # Fixed three-cell reading: fold / check-or-call / bet-or-raise.
    hsv=cv2.cvtColor(roi,cv2.COLOR_BGR2HSV)
    W=roi.shape[1]
    cells=[(0,int(W*.35)),(int(W*.35),int(W*.71)),(int(W*.71),W)]
    stats=[]
    for xa,xb in cells:
        z=hsv[:,xa:xb]; h,s,v=z[:,:,0],z[:,:,1],z[:,:,2]
        vivid=(s>70)&(v>90)
        ratio=float(vivid.mean())
        hue=float(np.median(h[vivid])) if vivid.any() else -1.0
        value=float(np.median(v[vivid])) if vivid.any() else 0.0
        stats.append((ratio,hue,value))
    mr,mh,mv=stats[1]; rr,rh,rv=stats[2]
    mid_blue=(mr>0.30 and 90<=mh<=135 and mv>=100)
    mid_green=(mr>0.30 and 35<=mh<=90 and mv>=100)
    right_aggr=(rr>0.45 and ((4<=rh<=30) or rh>=170 or rh<=5) and rv>=120)
    br=mr if mid_blue else 0.0; gr=mr if mid_green else 0.0; aggressive=rr if right_aggr else 0.0
    if mid_blue and right_aggr:
        return ButtonState(True,'check-bet',('CHECK','BET'),br,gr,aggressive)
    if mid_green and right_aggr:
        last='RAISE' if to_call is None or float(to_call)>0.001 else 'BET'
        return ButtonState(True,'fold-call-raise',('FOLD','CALL',last),br,gr,aggressive)
    return ButtonState(False,None,tuple(),br,gr,aggressive)

def hero_button_state(img, cal=DEFAULT_CAL, to_call=None):
    return hero_button_state_from_roi(crop(img,cal['heroButtons']),to_call)

def infer_action(prev, cur, table_max, eps=0.02):
    if prev.get('cards') and not cur.get('cards'): return 'fold'
    pc=float(prev.get('commitment') or 0); cc=float(cur.get('commitment') or 0); ps=prev.get('stack'); cs=cur.get('stack')
    if cs is not None and cs<=eps and ps is not None and ps>eps: return 'all-in'
    if cc>pc+eps: return 'raise' if cc>table_max+eps else 'call'
    if prev.get('turn') and not cur.get('turn') and abs(cc-pc)<=eps: return 'check'
    return None

class SessionHandTracker:
    def __init__(self):
        self.hand_id=0; self.cards=None; self.dealer=None; self.suspended=False; self.candidate=None; self.candidate_votes=0
    def observe(self, cards, present, dealer=None):
        cards=tuple(cards or ()) if present else tuple()
        if not present or len(cards)!=2:
            self.suspended=True; self.candidate=None; self.candidate_votes=0; return {'event':'suspended','handId':self.hand_id}
        if self.cards is None:
            self.hand_id=1; self.cards=cards; self.dealer=dealer; self.suspended=False; return {'event':'started','handId':self.hand_id}
        dealer_rotated=bool(dealer and self.dealer and dealer!=self.dealer)
        if cards==self.cards and not dealer_rotated:
            was=self.suspended; self.suspended=False; self.candidate=None; self.candidate_votes=0; return {'event':'resumed' if was else 'same','handId':self.hand_id}
        key=(cards,dealer)
        if self.candidate==key: self.candidate_votes+=1
        else: self.candidate=key; self.candidate_votes=1
        if self.candidate_votes<2: return {'event':'candidate','handId':self.hand_id}
        self.hand_id+=1; self.cards=cards; self.dealer=dealer; self.suspended=False; self.candidate=None; self.candidate_votes=0
        return {'event':'new-hand','handId':self.hand_id}

def validate_snapshot(s):
    errors=[]; hero=s.get('heroCards') or []; board=s.get('board') or []
    if len(hero)!=2 or any(not c for c in hero): errors.append('hero_cards_incomplete')
    if s.get('heroPresence') not in (None,'present'): errors.append('hero_not_present')
    if len(board) not in (0,3,4,5): errors.append('partial_board')
    if any(not c for c in board): errors.append('board_decode_gap')
    if s.get('heroTurnConfirmed') is not True: errors.append('hero_turn_not_confirmed')
    if not s.get('heroButtons'): errors.append('hero_buttons_missing')
    if not s.get('position'): errors.append('position_missing')
    tc=s.get('toCall'); st=s.get('heroStack'); pot=s.get('pot')
    if tc is None or st is None or pot is None: errors.append('money_incomplete')
    if tc is not None and st is not None and (tc<0 or tc>st+1e-6): errors.append('to_call_inconsistent')
    if s.get('actionComplete') is not True: errors.append('action_history_incomplete')
    return {'ok':not errors,'errors':errors}

def frame_at(cap,t):
    cap.set(cv2.CAP_PROP_POS_MSEC,float(t)*1000); ok,im=cap.read()
    if not ok: raise RuntimeError(f'cannot read frame at {t}')
    return im

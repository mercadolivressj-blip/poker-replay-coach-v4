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
    'hero': {'panel':(535,474,240,70),'cards':(570,430,140,56),'stack':(620,505,120,34),'commit':(545,370,220,60)},
    'lb': {'panel':(165,350,205,80),'cards':(200,318,140,66),'stack':(195,382,125,35),'commit':(335,325,210,70)},
    'lt': {'panel':(195,138,205,72),'cards':(235,105,135,62),'stack':(220,177,125,33),'commit':(340,155,280,80)},
    'top': {'panel':(540,75,205,72),'cards':(575,45,135,66),'stack':(565,111,125,33),'commit':(575,130,210,80)},
    'rt': {'panel':(880,138,205,72),'cards':(915,105,140,65),'stack':(955,177,125,33),'commit':(735,155,220,80)},
    'rb': {'panel':(910,350,205,80),'cards':(945,318,140,66),'stack':(990,383,125,35),'commit':(755,325,220,75)},
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
    """Fixed-theme PokerStars numeric reader.

    The right-most numeric token is segmented from the known ROI. Currency/text
    prefixes are ignored. Comma-decimal and integer-only displays are both
    supported. Ambiguous glyphs abstain instead of dropping a leading digit.
    """
    def __init__(self): self.bank={str(i):[] for i in range(10)}

    def _bw(self, roi):
        hsv=cv2.cvtColor(roi,cv2.COLOR_BGR2HSV); v=hsv[:,:,2]; sat=hsv[:,:,1]
        return (((sat<115)&(v>160)).astype(np.uint8))*255

    def _components(self, roi):
        bw=self._bw(roi); H=roi.shape[0]; out=[]
        for c in _contours(bw):
            x,y,w,h=cv2.boundingRect(c); ink=int(cv2.countNonZero(bw[y:y+h,x:x+w]))
            if h>=2 and ink>=3 and w<=32 and y<=H-4: out.append((x,y,w,h,ink))
        return sorted(out,key=lambda b:b[0])

    def _comma_x(self, roi):
        bw=self._bw(roi); H=roi.shape[0]; cand=[]
        for c in _contours(bw):
            x,y,w,h=cv2.boundingRect(c); ink=int(cv2.countNonZero(bw[y:y+h,x:x+w]))
            if 1<=w<=6 and 2<=h<=8 and y>=H*0.60 and area_ok(ink): cand.append((x,ink,y))
        return max(cand,key=lambda z:z[0])[0] if cand else None

    def _raw_digit_boxes(self, roi):
        bw=self._bw(roi); H=roi.shape[0]; out=[]
        for c in _contours(bw):
            x,y,w,h=cv2.boundingRect(c); ink=int(cv2.countNonZero(bw[y:y+h,x:x+w]))
            if h>=7 and ink>=9 and w<=32 and y<=H-5: out.append((x,y,w,h,ink))
        return sorted(out,key=lambda b:b[0])

    def _numeric_chain(self, roi):
        comps=[b for b in self._components(roi) if b[0] < (65 if roi.shape[1]>75 else 60)]
        if not comps: return []
        chain=[comps[-1]]
        for b in reversed(comps[:-1]):
            cur=chain[-1]; gap=cur[0]-(b[0]+b[2])
            if gap<=3 or (gap<=5 and (b[2]<=5 or cur[2]<=5)): chain.append(b)
            else: break
        return list(reversed(chain))

    def _commit_bw(self, roi):
        hsv=cv2.cvtColor(roi,cv2.COLOR_BGR2HSV); s=hsv[:,:,1]; v=hsv[:,:,2]
        return (((s<155)&(v>80)).astype(np.uint8))*255

    def _commit_dim_layout(self, roi):
        bw=self._commit_bw(roi)
        glyphs=[]; allc=[]
        for c in _contours(bw):
            x,y,w,h=cv2.boundingRect(c); ink=int(cv2.countNonZero(bw[y:y+h,x:x+w]))
            allc.append((x,y,w,h,ink))
            if 7<=h<=16 and w<=12 and ink>=10: glyphs.append((x,y,w,h,ink))
        glyphs.sort(key=lambda b:b[0])
        if len(glyphs)<4: return None
        prefixes=[]
        for i in range(len(glyphs)-3):
            a,b,c=glyphs[i:i+3]
            if max(a[1],b[1],c[1])-min(a[1],b[1],c[1])>4: continue
            g1=b[0]-(a[0]+a[2]); g2=c[0]-(b[0]+b[2])
            if g1>5 or g2>5: continue
            for j in range(i+3,len(glyphs)):
                d=glyphs[j]; g3=d[0]-(c[0]+c[2])
                if g3<3: continue
                if g3>16: break
                base=int(round((a[1]+b[1]+c[1]+d[1])/4))
                if abs(d[1]-base)<=4:
                    prefixes.append((i,j,base,c,d)); break
        if not prefixes: return None
        candidates=[]
        for i,j,base,prefix_end,first_amount in prefixes:
            amount=[]
            for b in glyphs[j:]:
                if abs(b[1]-base)>4: continue
                if amount and b[0]-(amount[-1][0]+amount[-1][2])>18: break
                amount.append(b)
            if not amount: continue
            punct=[]
            for x,y,w,h,ink in allc:
                if 1<=w<=4 and 1<=h<=5 and ink>=3 and base+7<=y<=base+16: punct.append((x,y,w,h,ink))
            comma=None
            for p in sorted(punct,key=lambda z:z[0]):
                before=[b for b in amount if b[0]+b[2] <= p[0]+1]
                after=[b for b in amount if b[0] >= p[0]+p[2]]
                if 1<=len(before)<=3 and len(after)>=2:
                    near_left=before[-1]; near_right=after[0]
                    if p[0]-(near_left[0]+near_left[2])<=6 and near_right[0]-(p[0]+p[2])<=7:
                        comma=p; break
            if comma is not None:
                before=[b for b in amount if b[0]+b[2] <= comma[0]+1][-3:]
                after=[b for b in amount if b[0] >= comma[0]+comma[2]][:2]
                if 1<=len(before)<=3 and len(after)==2:
                    boxes=before+after; score=sum(b[4] for b in boxes)
                    candidates.append((score,{'decimal':True,'style':'pot','nint':len(before),'boxes':boxes,'bwMode':'commit-dim','anchor':before[-1]}))
                    continue
            chain=[amount[0]]
            for b in amount[1:]:
                gap=b[0]-(chain[-1][0]+chain[-1][2])
                if gap<=6 and len(chain)<3: chain.append(b)
                else: break
            if chain:
                score=sum(b[4] for b in chain)
                candidates.append((score,{'decimal':False,'style':'pot','nint':len(chain),'boxes':chain,'bwMode':'commit-dim','anchor':chain[-1]}))
        if not candidates: return None
        return max(candidates,key=lambda q:q[0])[1]

    def _commit_layout(self, roi): return self._commit_dim_layout(roi)

    def _layout(self, roi, profile=None):
        if profile=='commit': return self._commit_layout(roi)
        chain=self._numeric_chain(roi)
        if not chain: return None
        start=min(b[0] for b in chain); end=max(b[0]+b[2] for b in chain); span=end-start
        style='stack' if profile=='stack' or (profile is None and roi.shape[1]>75) else 'pot'; pitch=9
        cx=self._comma_x(roi)
        decimal=(cx is not None and start<=cx<end) or span>30
        anchor=max((b for b in chain if b[3]>=7), key=lambda b:b[0], default=chain[-1])
        if decimal:
            if cx is None:
                bw=self._bw(roi); y0=max(0, roi.shape[0]-(5 if style=='stack' else 8)); y1=roi.shape[0]-(0 if style=='stack' else 4)
                band=bw[y0:y1,start:end]; col=(band>0).sum(axis=0); runs=[]; a=None
                for i,v in enumerate(col.tolist()+[0]):
                    if v and a is None:a=i
                    elif not v and a is not None:
                        if 1<=i-a<=6 and int(col[a:i].sum())<=16:runs.append(start+a)
                        a=None
                if runs:cx=runs[-1]
            if cx is None:return None
            nint=sum(1 for b in chain if b[3]>=7 and b[0]+b[2] <= cx+1)
            if not 1<=nint<=3:return None
            return {'decimal':True,'style':style,'nint':nint,'comma':cx,'anchor':anchor}
        digits=[b for b in chain if b[3]>=7]
        if not 1<=len(digits)<=3:return None
        return {'decimal':False,'style':style,'nint':len(digits),'boxes':digits,'anchor':digits[-1]}

    def _fixed_masks(self, roi, layout):
        if not layout:return []
        bw=self._commit_bw(roi) if layout.get('bwMode')=='commit-dim' else self._bw(roi)
        if 'boxes' in layout:
            masks=[]
            for x,y,w,h,*_ in layout['boxes']:
                m=np.zeros_like(bw); m[y:y+h,x:x+w]=bw[y:y+h,x:x+w]; masks.append(m)
            return masks
        cx=layout['comma']; n=layout['nint']; style=layout['style']; anchor=layout['anchor']
        if style=='stack': last=cx-10; pitch=9; dec=[cx+4,cx+14]
        else: last=cx-9; pitch=9; dec=[cx+4,cx+13]
        starts=[last-pitch*(n-1-i) for i in range(n)]+dec
        masks=[]; y0=max(0,anchor[1]-2); y1=min(bw.shape[0],anchor[1]+anchor[3]+4)
        for x0 in starts:
            xa=max(0,int(x0)-1); xb=min(bw.shape[1],xa+11); z=bw[y0:y1,xa:xb]; best=None
            for c in _contours(z):
                x,y,w,h=cv2.boundingRect(c); ink=int(cv2.countNonZero(z[y:y+h,x:x+w]))
                if h>=7 and ink>=9 and w<=11 and (best is None or ink>best[0]):best=(ink,x,y,w,h)
            if best is None:return []
            _,x,y,w,h=best; m=np.zeros_like(bw); m[y0+y:y0+y+h,xa+x:xa+x+w]=z[y:y+h,x:x+w]; masks.append(m)
        return masks

    def add_labeled(self, roi, value, profile=None):
        layout=self._layout(roi,profile); masks=self._fixed_masks(roi,layout)
        if not layout:return False
        if layout['decimal']:
            left,right=f'{float(value):.2f}'.split('.'); labels=left+right
        else: labels=str(int(round(float(value))))
        if len(masks)!=len(labels):return False
        for ch,m in zip(labels,masks):self.bank[ch].append(norm_gray(m))
        return True

    def ready(self): return all(self.bank[d] for d in self.bank)

    def classify_digit(self, mask):
        z=norm_gray(mask).astype(np.float32)/255; scores=[]
        for d,temps in self.bank.items():
            best=-1.0
            for t in temps:
                a=t.astype(np.float32)/255
                sc=float(np.sum(np.minimum(a,z))/(np.sum(np.maximum(a,z))+1e-6)); best=max(best,sc)
            if best>=0:scores.append((d,best))
        scores.sort(key=lambda x:x[1],reverse=True)
        if not scores:return '?',0.0,0.0
        second=scores[1][1] if len(scores)>1 else 0.0
        return scores[0][0],scores[0][1],scores[0][1]-second

    def read(self, roi, profile=None):
        layout=self._layout(roi,profile); masks=self._fixed_masks(roi,layout)
        if not layout or not masks:return None,0.0,''
        chars=[]; scores=[]; margins=[]
        for m in masks:
            d,sc,margin=self.classify_digit(m); chars.append(d); scores.append(sc); margins.append(margin)
        if '?' in chars or min(scores)<0.40 or float(np.mean(scores))<0.50 or min(margins)<0.01:
            return None,float(np.mean(scores) if scores else 0.0),''
        if layout['decimal']: text=''.join(chars[:layout['nint']])+','+''.join(chars[layout['nint']:])
        else:text=''.join(chars)
        return float(text.replace(',','.')),float(np.mean(scores)),text

def area_ok(v): return v>=3

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
    g=cv2.cvtColor(panel_roi,cv2.COLOR_BGR2GRAY); return float((g>95).mean())>0.055

def seat_dealt_in(cards_roi, hero=False):
    hsv=cv2.cvtColor(cards_roi,cv2.COLOR_BGR2HSV); h,s,v=hsv[:,:,0],hsv[:,:,1],hsv[:,:,2]
    if hero:
        white=((s<65)&(v>170)); return bool(float(white.mean())>0.18)
    red=(((h<10)|(h>170))&(s>80)&(v>50)); return bool(float(red.mean())>0.12)

def dealt_seats(img, cal=DEFAULT_CAL):
    return [seat for seat,row in cal['seats'].items() if seat_dealt_in(crop(img,row['cards']),hero=(seat=='hero'))]

def dealer_center(img, cal=DEFAULT_CAL):
    """Detect the actual PokerStars dealer button by its fixed theme signature."""
    hsv=cv2.cvtColor(img,cv2.COLOR_BGR2HSV); h,s,v=hsv[:,:,0],hsv[:,:,1],hsv[:,:,2]
    red=(((h<12)|(h>168))&(s>100)&(v>100)); white=((s<60)&(v>170))
    mask=((red|white).astype(np.uint8))*255; best=None
    for c in _contours(mask):
        x,y,w,hh=cv2.boundingRect(c); area=float(cv2.contourArea(c))
        if not (28<=w<=32 and 23<=hh<=28 and 430<=area<=600): continue
        if not (250<=x<=1030 and 140<=y<=460): continue
        rh=h[y:y+hh,x:x+w]; rs=s[y:y+hh,x:x+w]; rv=v[y:y+hh,x:x+w]
        rr=float(((((rh<12)|(rh>168))&(rs>100)&(rv>100))).mean()); wr=float(((rs<60)&(rv>170)).mean())
        if rr<0.18 or wr<0.30: continue
        score=1.0-abs(w/float(hh)-1.2)-abs(rr-.25)-abs(wr-.42)
        if best is None or score>best[0]:best=(score,(int(x+w/2),int(y+hh/2)))
    return best[1] if best else None

SEAT_CENTERS={'hero':(655,510),'lb':(270,390),'lt':(300,170),'top':(640,110),'rt':(980,170),'rb':(1010,390)}
def dealer_seat(img):
    c=dealer_center(img)
    if not c:return None,c
    return min(SEAT_CENTERS,key=lambda s:(SEAT_CENTERS[s][0]-c[0])**2+(SEAT_CENTERS[s][1]-c[1])**2),c

def hero_position_from_dealer(dealer, active):
    active=[s for s in CLOCKWISE_SEATS if s in set(active)]
    if dealer not in active or 'hero' not in active or len(active)<2:return None
    i=active.index(dealer); ordered=active[i:]+active[:i]; n=len(ordered)
    labels={2:['BTN/SB','BB'],3:['BTN','SB','BB'],4:['BTN','SB','BB','CO'],5:['BTN','SB','BB','UTG','CO'],6:['BTN','SB','BB','UTG','HJ','CO']}.get(n)
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
    hsv=cv2.cvtColor(roi,cv2.COLOR_BGR2HSV); W=roi.shape[1]
    cells=[(0,int(W*.35)),(int(W*.35),int(W*.71)),(int(W*.71),W)]; stats=[]
    for xa,xb in cells:
        z=hsv[:,xa:xb]; h,s,v=z[:,:,0],z[:,:,1],z[:,:,2]; vivid=(s>70)&(v>90)
        ratio=float(vivid.mean()); hue=float(np.median(h[vivid])) if vivid.any() else -1.; value=float(np.median(v[vivid])) if vivid.any() else 0.
        stats.append((ratio,hue,value))
    mr,mh,mv=stats[1]; rr,rh,rv=stats[2]
    mid_blue=(mr>0.30 and 90<=mh<=135 and mv>=100); mid_green=(mr>0.30 and 35<=mh<=90 and mv>=100)
    right_aggr=(rr>0.45 and ((4<=rh<=30) or rh>=170 or rh<=5) and rv>=120)
    br=mr if mid_blue else 0.; gr=mr if mid_green else 0.; aggressive=rr if right_aggr else 0.
    if mid_blue and right_aggr:return ButtonState(True,'check-bet',('CHECK','BET'),br,gr,aggressive)
    if mid_green and right_aggr:
        last='RAISE' if to_call is None or float(to_call)>0.001 else 'BET'; return ButtonState(True,'fold-call-raise',('FOLD','CALL',last),br,gr,aggressive)
    return ButtonState(False,None,tuple(),br,gr,aggressive)

def hero_button_state(img, cal=DEFAULT_CAL, to_call=None): return hero_button_state_from_roi(crop(img,cal['heroButtons']),to_call)

def seat_turn_score(img, seat, cal=DEFAULT_CAL):
    row=cal['seats'][seat]; x,y,w,h=row['panel']; roi=img[max(0,y+h-15):min(img.shape[0],y+h+12),x:x+w]
    hsv=cv2.cvtColor(roi,cv2.COLOR_BGR2HSV); hh,ss,vv=hsv[:,:,0],hsv[:,:,1],hsv[:,:,2]
    progress=((hh>=20)&(hh<=90)&(ss>100)&(vv>100)); return float(progress.mean())

def turn_seat(img, cal=DEFAULT_CAL, threshold=0.03):
    scores={seat:seat_turn_score(img,seat,cal) for seat in cal['seats']}; seat=max(scores,key=scores.get) if scores else None
    return (seat if seat is not None and scores[seat]>=threshold else None),scores

def infer_action(prev, cur, table_max, eps=0.02):
    if prev.get('cards') and not cur.get('cards'):return 'fold'
    pc=float(prev.get('commitment') or 0); cc=float(cur.get('commitment') or 0); ps=prev.get('stack'); cs=cur.get('stack')
    if cs is not None and cs<=eps and ps is not None and ps>eps:return 'all-in'
    if cc>pc+eps:return 'raise' if cc>table_max+eps else 'call'
    if prev.get('turn') and not cur.get('turn') and abs(cc-pc)<=eps and pc>=table_max-eps:return 'check'
    return None

class SessionHandTracker:
    def __init__(self):
        self.hand_id=0; self.cards=None; self.dealer=None; self.suspended=False; self.candidate=None; self.candidate_votes=0
    def observe(self, cards, present, dealer=None):
        cards=tuple(cards or ()) if present else tuple()
        if not present or len(cards)!=2:
            self.suspended=True; self.candidate=None; self.candidate_votes=0; return {'event':'suspended','handId':self.hand_id}
        if self.cards is None:
            key=(cards,dealer)
            if self.candidate==key:self.candidate_votes+=1
            else:self.candidate=key;self.candidate_votes=1
            if self.candidate_votes<2:return {'event':'candidate','handId':0}
            self.hand_id=1; self.cards=cards; self.dealer=dealer; self.suspended=False; self.candidate=None; self.candidate_votes=0
            return {'event':'started','handId':self.hand_id}
        dealer_rotated=bool(dealer and self.dealer and dealer!=self.dealer)
        if cards==self.cards and not dealer_rotated:
            was=self.suspended; self.suspended=False; self.candidate=None; self.candidate_votes=0; return {'event':'resumed' if was else 'same','handId':self.hand_id}
        key=(cards,dealer)
        if self.candidate==key:self.candidate_votes+=1
        else:self.candidate=key;self.candidate_votes=1
        if self.candidate_votes<2:return {'event':'candidate','handId':self.hand_id}
        self.hand_id+=1; self.cards=cards; self.dealer=dealer; self.suspended=False; self.candidate=None; self.candidate_votes=0
        return {'event':'new-hand','handId':self.hand_id}

def validate_snapshot(s):
    errors=[]; hero=s.get('heroCards') or []; board=s.get('board') or []
    if len(hero)!=2 or any(not c for c in hero):errors.append('hero_cards_incomplete')
    if s.get('heroPresence') not in (None,'present'):errors.append('hero_not_present')
    if len(board) not in (0,3,4,5):errors.append('partial_board')
    if any(not c for c in board):errors.append('board_decode_gap')
    if s.get('heroTurnConfirmed') is not True:errors.append('hero_turn_not_confirmed')
    if not s.get('heroButtons'):errors.append('hero_buttons_missing')
    if not s.get('position'):errors.append('position_missing')
    tc=s.get('toCall'); st=s.get('heroStack'); pot=s.get('pot')
    if tc is None or st is None or pot is None:errors.append('money_incomplete')
    if tc is not None and st is not None and (tc<0 or tc>st+1e-6):errors.append('to_call_inconsistent')
    if s.get('actionComplete') is not True:errors.append('action_history_incomplete')
    return {'ok':not errors,'errors':errors}

def frame_at(cap,t):
    cap.set(cv2.CAP_PROP_POS_MSEC,float(t)*1000); ok,im=cap.read()
    if not ok:raise RuntimeError(f'cannot read frame at {t}')
    return im

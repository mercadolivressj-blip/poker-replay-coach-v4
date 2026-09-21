from __future__ import annotations
import cv2
import numpy as np
from dataclasses import dataclass

BASE_W, BASE_H = 1280, 720

DEFAULT_CAL = {
  'heroCards': [(578,436,60,43),(641,436,61,43)],
  'board': [(476,236,60,85),(543,236,60,85),(610,236,60,85),(677,236,60,85),(744,236,60,85)],
  'potValue': (640,212,70,25),
  'heroStackValue': (650,510,85,26),
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
    """Theme-specific numeric template matcher; deliberately not broad OCR."""
    def __init__(self): self.bank={str(i):[] for i in range(10)}
    def _bw(self, roi):
        hsv=cv2.cvtColor(roi,cv2.COLOR_BGR2HSV); v=hsv[:,:,2]; sat=hsv[:,:,1]
        med=float(np.median(v)); th=175 if med>45 else 60
        return (((sat<105)&(v>th)).astype(np.uint8))*255
    def _comma_x(self, roi):
        bw=self._bw(roi); n,lab,stats,cent=cv2.connectedComponentsWithStats(bw,8); cand=[]; H=roi.shape[0]
        for i in range(1,n):
            x,y,w,h,area=map(int,stats[i])
            if 1<=w<=5 and 2<=h<=8 and y>=H*0.52 and area>=3: cand.append((area,y,x))
        return max(cand,key=lambda z:z[2])[2] if cand else None
    def _digit_mask(self, roi, x0):
        bw=self._bw(roi); x0=max(0,int(x0)); z=bw[:,x0:min(bw.shape[1],x0+9)]
        n,lab,stats,cent=cv2.connectedComponentsWithStats(z,8); best=None
        for i in range(1,n):
            x,y,w,h,area=map(int,stats[i])
            if h>=7 and area>=10 and (best is None or area>best[0]): best=(area,i,(x,y,w,h))
        if best is None: return np.zeros_like(z),0
        _,i,(x,y,w,h)=best; m=np.zeros_like(z); m[y:y+h,x:x+w]=(lab[y:y+h,x:x+w]==i).astype(np.uint8)*255
        return m,int(best[0])
    def _starts(self, roi, comma_x, integer_digits, profile=None):
        profile = profile or ('stack' if roi.shape[1] > 75 else 'pot')
        if profile == 'stack': last=comma_x-10; pitch=9; dec=[comma_x+4,comma_x+14]
        else: last=comma_x-9; pitch=9; dec=[comma_x+4,comma_x+13]
        return [last-pitch*(integer_digits-1-i) for i in range(integer_digits)]+dec
    def add_labeled(self, roi, value, profile=None):
        left,right=f'{float(value):.2f}'.split('.'); cx=self._comma_x(roi)
        if cx is None: return False
        ok=True
        for ch,x0 in zip(left+right,self._starts(roi,cx,len(left),profile)):
            m,area=self._digit_mask(roi,x0)
            if area<10: ok=False; continue
            self.bank[ch].append(norm_gray(m))
        return ok
    def ready(self): return all(self.bank[d] for d in self.bank)
    def classify_digit(self, mask):
        z=norm_gray(mask).astype(np.float32)/255; best=('?',-1.0)
        for d,temps in self.bank.items():
            for t in temps:
                a=t.astype(np.float32)/255; score=float(np.sum(np.minimum(a,z))/(np.sum(np.maximum(a,z))+1e-6))
                if score>best[1]: best=(d,score)
        return best
    def read(self, roi, profile=None):
        cx=self._comma_x(roi)
        if cx is None: return None,0.0,''
        best=None
        for nint in (2,1):
            chars=[]; scores=[]; valid=True
            for x0 in self._starts(roi,cx,nint,profile):
                m,area=self._digit_mask(roi,x0)
                if area<10: valid=False; break
                d,sc=self.classify_digit(m); chars.append(d); scores.append(sc)
            if not valid: continue
            text=''.join(chars[:nint])+','+''.join(chars[nint:]); conf=float(np.mean(scores)); result=(float(text.replace(',','.')),conf,text)
            if conf>=0.45: return result
            if best is None or conf>best[1]: best=result
        return best if best else (None,0.0,'')

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

def dealer_center(img, cal=DEFAULT_CAL):
    x,y,w,h=cal['table']; roi=img[y:y+h,x:x+w]; hsv=cv2.cvtColor(roi,cv2.COLOR_BGR2HSV)
    red=((hsv[:,:,0]<12)|(hsv[:,:,0]>168))&(hsv[:,:,1]>110)&(hsv[:,:,2]>120); white=(hsv[:,:,1]<45)&(hsv[:,:,2]>190)
    mask=((red|white).astype(np.uint8))*255; n,lab,stats,cent=cv2.connectedComponentsWithStats(mask,8); best=None; board_box=(450-x,215-y,380,125)
    for i in range(1,n):
        bx,by,bw,bh,area=map(int,stats[i]); cx,cy=cent[i]
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

def infer_action(prev, cur, table_max, eps=0.02):
    if prev.get('cards') and not cur.get('cards'): return 'fold'
    pc=float(prev.get('commitment') or 0); cc=float(cur.get('commitment') or 0); ps=prev.get('stack'); cs=cur.get('stack')
    if cs is not None and cs<=eps and ps is not None and ps>eps: return 'all-in'
    if cc>pc+eps: return 'raise' if cc>table_max+eps else 'call'
    if prev.get('turn') and not cur.get('turn') and abs(cc-pc)<=eps: return 'check'
    return None

def validate_snapshot(s):
    errors=[]; hero=s.get('heroCards') or []; board=s.get('board') or []
    if len(hero)!=2 or any(not c for c in hero): errors.append('hero_cards_incomplete')
    if len(board) not in (0,3,4,5): errors.append('partial_board')
    if any(not c for c in board): errors.append('board_decode_gap')
    if not s.get('heroButtons'): errors.append('hero_buttons_missing')
    if not s.get('position'): errors.append('position_missing')
    tc=s.get('toCall'); st=s.get('heroStack')
    if tc is not None and st is not None and (tc<0 or tc>st+1e-6): errors.append('to_call_inconsistent')
    if s.get('actionComplete') is not True: errors.append('action_history_incomplete')
    return {'ok':not errors,'errors':errors}

def frame_at(cap,t):
    cap.set(cv2.CAP_PROP_POS_MSEC,float(t)*1000); ok,im=cap.read()
    if not ok: raise RuntimeError(f'cannot read frame at {t}')
    return im

from __future__ import annotations
import cv2
import numpy as np
from pokerstars_offline import _contours, norm_gray

COMMIT_ROIS={
 'hero':(545,370,220,60),
 'lb':(335,325,210,70),
 'lt':(340,155,280,80),
 'top':(575,130,210,80),
 'rt':(735,155,220,80),
 'rb':(755,325,220,75),
}

def commitment_crop(img,seat):
    x,y,w,h=COMMIT_ROIS[seat]
    return img[y:y+h,x:x+w]

def _bw(roi):
    hsv=cv2.cvtColor(roi,cv2.COLOR_BGR2HSV); s=hsv[:,:,1]; v=hsv[:,:,2]
    return (((s<155)&(v>80)).astype(np.uint8))*255

def _layout(roi):
    bw=_bw(roi); glyphs=[]; allc=[]
    for c in _contours(bw):
        x,y,w,h=cv2.boundingRect(c); ink=int(cv2.countNonZero(bw[y:y+h,x:x+w]))
        allc.append((x,y,w,h,ink))
        if 7<=h<=16 and w<=12 and ink>=10: glyphs.append((x,y,w,h,ink))
    glyphs.sort(key=lambda b:b[0])
    if len(glyphs)<4:return None
    prefixes=[]
    for i in range(len(glyphs)-3):
        a,b,c=glyphs[i:i+3]
        if max(a[1],b[1],c[1])-min(a[1],b[1],c[1])>4:continue
        g1=b[0]-(a[0]+a[2]); g2=c[0]-(b[0]+b[2])
        if g1>5 or g2>5:continue
        for j in range(i+3,len(glyphs)):
            d=glyphs[j]; g3=d[0]-(c[0]+c[2])
            if g3<3:continue
            if g3>16:break
            base=int(round((a[1]+b[1]+c[1]+d[1])/4))
            if abs(d[1]-base)<=4:
                prefixes.append((j,base));break
    candidates=[]
    # Primary path: amount following a visible `US$`-like prefix.
    # Some PokerStars commitment labels sit against the ROI edge, clipping the
    # leading `U`. In that case the prefix detector can fail even though the
    # numeric `1,20` row is perfectly visible. Keep the prefix path when it is
    # available, but add a decimal-row fallback below instead of returning.
    for j,base in prefixes:
        amount=[]
        for b in glyphs[j:]:
            if abs(b[1]-base)>4:continue
            if amount and b[0]-(amount[-1][0]+amount[-1][2])>18:break
            amount.append(b)
        if not amount:continue
        punct=[]
        for x,y,w,h,ink in allc:
            if 1<=w<=4 and 1<=h<=5 and ink>=3 and base+7<=y<=base+16: punct.append((x,y,w,h,ink))
        comma=None
        for p in sorted(punct,key=lambda z:z[0]):
            before=[b for b in amount if b[0]+b[2]<=p[0]+1]
            after=[b for b in amount if b[0]>=p[0]+p[2]]
            if 1<=len(before)<=3 and len(after)>=2:
                l=before[-1]; r=after[0]
                if p[0]-(l[0]+l[2])<=6 and r[0]-(p[0]+p[2])<=7:
                    comma=p;break
        if comma is not None:
            before=[b for b in amount if b[0]+b[2]<=comma[0]+1][-3:]
            after=[b for b in amount if b[0]>=comma[0]+comma[2]][:2]
            if 1<=len(before)<=3 and len(after)==2:
                boxes=before+after; candidates.append((sum(b[4] for b in boxes),True,len(before),boxes));continue
        chain=[amount[0]]
        for b in amount[1:]:
            gap=b[0]-(chain[-1][0]+chain[-1][2])
            if gap<=6 and len(chain)<3:chain.append(b)
            else:break
        if chain:candidates.append((sum(b[4] for b in chain),False,len(chain),chain))
    # Fallback: detect the amount from the decimal comma itself. We only accept
    # an aligned chain with exactly two decimal glyphs and 1-3 integer glyphs.
    # Walking left from the comma by tight glyph gaps prevents a clipped `S$`
    # prefix from being mistaken for leading integer digits.
    if not candidates:
        punct=[]
        for x,y,w,h,ink in allc:
            if 1<=w<=4 and 1<=h<=6 and ink>=3:
                punct.append((x,y,w,h,ink))
        for p in sorted(punct,key=lambda z:z[0]):
            # amount digits share a baseline and the comma sits near their foot
            aligned=[b for b in glyphs if abs((b[1]+b[3])-(p[1]+p[3]))<=5]
            left=[b for b in aligned if b[0]+b[2]<=p[0]+1]
            right=[b for b in aligned if b[0]>=p[0]+p[2]]
            if len(right)<2 or not left: continue
            # nearest two digits after comma must form a tight cents pair
            after=right[:2]
            if after[0][0]-(p[0]+p[2])>7: continue
            if after[1][0]-(after[0][0]+after[0][2])>5: continue
            # build integer part right-to-left, stopping at prefix-sized gap
            before=[left[-1]]
            for b in reversed(left[:-1]):
                gap=before[-1][0]-(b[0]+b[2])
                if gap<=4 and len(before)<3: before.append(b)
                else: break
            before=list(reversed(before))
            if p[0]-(before[-1][0]+before[-1][2])>6: continue
            boxes=before+after
            candidates.append((sum(b[4] for b in boxes),True,len(before),boxes))
    if not candidates:return None
    _,decimal,nint,boxes=max(candidates,key=lambda q:q[0])
    return {'decimal':decimal,'nint':nint,'boxes':boxes}

def _masks(roi,layout):
    if not layout:return []
    bw=_bw(roi); out=[]
    for x,y,w,h,*_ in layout['boxes']:
        m=np.zeros_like(bw); m[y:y+h,x:x+w]=bw[y:y+h,x:x+w];out.append(m)
    return out

def add_commitment_labeled(nt,roi,value):
    layout=_layout(roi); masks=_masks(roi,layout)
    if not layout:return False
    if layout['decimal']:
        left,right=f'{float(value):.2f}'.split('.'); labels=left+right
    else:labels=str(int(round(float(value))))
    if len(masks)!=len(labels):return False
    for ch,m in zip(labels,masks):nt.bank[ch].append(norm_gray(m))
    return True

def read_commitment(nt,roi):
    layout=_layout(roi); masks=_masks(roi,layout)
    if not layout or not masks:return None,0.0,''
    chars=[];scores=[];margins=[]
    for m in masks:
        d,sc,margin=nt.classify_digit(m);chars.append(d);scores.append(sc);margins.append(margin)
    mean=float(np.mean(scores)) if scores else 0.0
    if '?' in chars or min(scores)<0.40 or mean<0.50 or min(margins)<0.01:return None,mean,''
    if layout['decimal']:text=''.join(chars[:layout['nint']])+','+''.join(chars[layout['nint']:])
    else:text=''.join(chars)
    return float(text.replace(',','.')),mean,text

def commitment_layout(roi):
    return _layout(roi)

def seat_turn_score(img,seat,panels):
    x,y,w,h=panels[seat]
    roi=img[max(0,y+h-15):min(img.shape[0],y+h+12),x:x+w]
    hsv=cv2.cvtColor(roi,cv2.COLOR_BGR2HSV); hh,ss,vv=hsv[:,:,0],hsv[:,:,1],hsv[:,:,2]
    return float((((hh>=20)&(hh<=90)&(ss>100)&(vv>100))).mean())

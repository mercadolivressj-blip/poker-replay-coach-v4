#!/usr/bin/env python3
from __future__ import annotations
import cv2, json, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'/'offline_vision'))
from pokerstars_offline import *
from pokerstars_commitments import commitment_crop, add_commitment_labeled, read_commitment, commitment_layout
from card_templates import CardTemplates
import card_templates as cm

if len(sys.argv)!=4:
    raise SystemExit('usage: python3 tests/offline_video3_regression.py "/path/session1.mkv" "/path/session2.mkv" "/path/session3.mkv"')
VIDEO1,VIDEO2,VIDEO3=sys.argv[1:4]
GT1=json.loads((ROOT/'standalone-lab/calibration/session-2026-09-20-ground-truth-v2.json').read_text())
GT2=json.loads((ROOT/'standalone-lab/calibration/session-2026-09-21-ground-truth-v1.json').read_text())
GT3=json.loads((ROOT/'standalone-lab/calibration/session-2026-09-21-video3-ground-truth-v1.json').read_text())
ACTION3=json.loads((ROOT/'standalone-lab/calibration/session-2026-09-21-video3-action-gate-v1.json').read_text())

POT1=[1.25,1.19,3.64,2.00,1.25,.75,1.19,4.99,5.94,.75,2.74,1.90,2.66,3.33,.75,2.14,4.04,11.35,17.12,.75,2.14,2.14,2.64,3.00,.75,1.94,.75,.75,1.45,.75,1.75,3.32,4.32,6.72,.75,5.50,7.84,13.84,15.44,25.44,33.49,75.24,1.90,22.30,1.75,3.56,5.34]
BOARD1={3:['5c','Tc','2h','4d'],9:['6d','3c','As','9s','2s'],14:['As','6c','Js'],19:['7h','9s','As','Th','6h'],23:['As','7d','9s','4d','Ah'],26:['4d','2s','6c'],29:['8s','9c','9s'],34:['Jc','7c','Kh','8s','5c'],42:['Tc','Th','As','3c','Td'],47:['Td','6s','Ts','6c']}
COMMIT1=[(80.0,'top',.50),(80.0,'hero',.25),(128.5,'top',.25),(128.5,'rt',.50),(212.5,'rb',.25),(212.5,'hero',.50),(247.0,'lb',.50),(247.0,'hero',.25),(269.0,'rt',.67),(373.0,'rt',6.81),(396.0,'rt',.25),(396.0,'rb',.50),(662.6,'lt',.25),(721.2,'lt',3.75),(752.8,'lt',9.50),(769.0,'lt',41.75),(877.6,'lt',.50)]

def collect(video, times):
    cap=cv2.VideoCapture(video); assert cap.isOpened(),video
    fps=cap.get(cv2.CAP_PROP_FPS); W=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); H=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    assert W==1280 and H==720 and abs(fps-30)<.05,(video,W,H,fps)
    mapping={int(round(float(t)*fps)):float(t) for t in times}
    ids=sorted(mapping); want=set(ids); out={}; fi=0; last=max(ids)
    while fi<=last:
        ok=cap.grab()
        if not ok: break
        if fi in want:
            ok,im=cap.retrieve(); assert ok
            out[mapping[fi]]=im.copy()
        fi+=1
    cap.release()
    assert len(out)==len(mapping),(video,len(out),len(mapping),sorted(set(mapping.values())-set(out)))
    return out,fi

t1=set()
for w in GT1['heroDecisionWindows']: t1.add(float(w['best_t']))
for t,_,_ in COMMIT1:t1.add(float(t))
f1,decoded1=collect(VIDEO1,t1)

t2={float(GT2['decisions'][2]['best_t']),float(GT2['decisions'][11]['best_t'])}
f2,decoded2=collect(VIDEO2,t2)

t3={float(d['best_t']) for d in GT3['decisions']}
for h in GT3['hands']:
    for dt in (-.6,-.4,-.2,0,.2,.4,.6,.8,1.0):t3.add(round(float(h['stableAt'])+dt,10))
f3,decoded3=collect(VIDEO3,t3)

hero=CardTemplates(rank_min=.50,suit_min=.46,rank_margin=.008,suit_margin=.018)
board=CardTemplates(rank_min=.48,suit_min=.44,rank_margin=.008,suit_margin=.006)
stack=NumericTemplates(); pot=NumericTemplates(); commit=NumericTemplates()
for w in GT1['heroDecisionWindows']:
    im=f1[float(w['best_t'])]; cards=GT1['hands'][w['hand']-1]['heroCards']
    for r,c in zip(DEFAULT_CAL['heroCards'],cards):hero.add(crop(im,r),c)
    assert stack.add_labeled(crop(im,DEFAULT_CAL['heroStackValue']),w['heroStack'],'stack')
im=f2[float(GT2['decisions'][2]['best_t'])]; hero.add(crop(im,DEFAULT_CAL['heroCards'][1]),'6h')
for di,cards in BOARD1.items():
    w=GT1['heroDecisionWindows'][di-1]; im=f1[float(w['best_t'])]
    for r,c in zip(DEFAULT_CAL['board'],cards):board.add(crop(im,r),c,include_suit=(c!='As'))
for w in GT1['heroDecisionWindows']:
    cards=GT1['hands'][w['hand']-1]['heroCards']
    if any(c[0]=='Q' for c in cards):
        im=f1[float(w['best_t'])]
        for r,c in zip(DEFAULT_CAL['heroCards'],cards):
            if c[0]=='Q':board.ranks.setdefault('Q',[]).append(cm._glyph(crop(im,r),'rank'))
        break
for w,val in zip(GT1['heroDecisionWindows'],POT1):
    assert pot.add_labeled(crop(f1[float(w['best_t'])],DEFAULT_CAL['potValue']),val,'pot')
assert pot.add_labeled(crop(f2[float(GT2['decisions'][11]['best_t'])],DEFAULT_CAL['potValue']),GT2['decisions'][11]['pot'],'pot')
for t,s,v in COMMIT1:assert add_commitment_labeled(commit,commitment_crop(f1[float(t)],s),v)

metrics={'buttons':0,'heroCards':0,'boardCards':0,'boardCardsTotal':0,'stack':0,'pot':0,'toCall':0}
errors=[]
for d in GT3['decisions']:
    im=f3[float(d['best_t'])]
    bs=hero_button_state(im)
    if bs.confirmed and bs.layout==d['layout']:metrics['buttons']+=1
    else:errors.append(('buttons',d['i'],bs.layout,d['layout']))
    got=[hero.read(crop(im,r))[0] for r in DEFAULT_CAL['heroCards']]
    if got==d['heroCards']:metrics['heroCards']+=1
    else:errors.append(('heroCards',d['i'],got,d['heroCards']))
    present=[x.present for x in board_presence(im)]
    got_board=[board.read(crop(im,r))[0] for p,r in zip(present,DEFAULT_CAL['board']) if p]
    metrics['boardCardsTotal']+=len(d['board'])
    if got_board==d['board']:metrics['boardCards']+=len(got_board)
    else:errors.append(('board',d['i'],got_board,d['board']))
    sv,_,_=stack.read(crop(im,DEFAULT_CAL['heroStackValue']),'stack')
    pv,_,_=pot.read(crop(im,DEFAULT_CAL['potValue']),'pot')
    if sv is not None and abs(sv-d['heroStack'])<.011:metrics['stack']+=1
    else:errors.append(('stack',d['i'],sv,d['heroStack']))
    if pv is not None and abs(pv-d['pot'])<.011:metrics['pot']+=1
    else:errors.append(('pot',d['i'],pv,d['pot']))
    commits={}; ambiguous=[]
    for seat in DEFAULT_CAL['seats']:
        roi=commitment_crop(im,seat); v,_,_=read_commitment(commit,roi); lay=commitment_layout(roi)
        if v is None and lay is None:v=0.0
        elif v is None:ambiguous.append(seat)
        commits[seat]=v
    vals=[v for v in commits.values() if v is not None]
    hc=commits['hero']; mx=max(vals) if vals else None
    tc=None if hc is None or mx is None else round(max(0,mx-hc)+1e-9,2)
    if not ambiguous and tc is not None and abs(tc-d['toCall'])<.011:metrics['toCall']+=1
    else:errors.append(('toCall',d['i'],tc,d['toCall'],ambiguous,commits))

positions=0; position_votes=[]
for h in GT3['hands']:
    votes=[]
    for dt in (-.6,-.4,-.2,0,.2,.4,.6,.8,1.0):
        t=round(float(h['stableAt'])+dt,10); im=f3[t]
        dealer,_=dealer_seat(im); active=dealt_seats(im); pos=hero_position_from_dealer(dealer,active)
        votes.append((dealer,tuple(active),pos))
    expected=(h['dealer'],tuple(h['dealtSeats']),h['heroPosition'])
    n=sum(v==expected for v in votes); position_votes.append((h['hand'],n)); positions+=int(n>=2)

assert metrics['buttons']==40,metrics
assert metrics['heroCards']==40,metrics
assert metrics['boardCards']==metrics['boardCardsTotal']==63,metrics
assert metrics['stack']==40,metrics
assert metrics['pot']==40,metrics
assert metrics['toCall']==40,(metrics,[e for e in errors if e[0]=='toCall'])
assert positions==19,(positions,position_votes)
assert ACTION3['decisionCount']==ACTION3['completeCount']==40
assert ACTION3['syntheticFastFoldCount']==26
assert ACTION3['walks'][0]['hand']==3 and ACTION3['walks'][0]['complete'] and len(ACTION3['walks'][0]['folds'])==5
assert sum(ACTION3['counts'].values())==129
assert not errors,errors

print(json.dumps({
 'ok':True,
 'session3':{
   'hands':'19/19','decisions':'40/40','buttons':'40/40','heroCards':'40/40',
   'boardCards':'63/63','heroStack':'40/40','pot':'40/40','toCall':'40/40','positions':'19/19',
   'decisionHistory':'40/40','handContinuity':'19/19','fastFoldsRecovered':26,'actionEvents':129,
 },
 'blindCriticalError':GT3['manualAudit']['blindCriticalErrors'],
 'runtimeButtonOcrUsedForToCall':False,
 'decodedFrames':{'session1TrainingPass':decoded1,'session2CalibrationPass':decoded2,'session3Pass':decoded3},
},indent=2))

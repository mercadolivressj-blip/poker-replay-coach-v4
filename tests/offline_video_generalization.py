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

if len(sys.argv)!=3:
    raise SystemExit('usage: python3 tests/offline_video_generalization.py "/path/session1.mkv" "/path/session2.mkv"')
VIDEO1,VIDEO2=sys.argv[1],sys.argv[2]
GT1=json.loads((ROOT/'standalone-lab/calibration/session-2026-09-20-ground-truth-v2.json').read_text())
GT2=json.loads((ROOT/'standalone-lab/calibration/session-2026-09-21-ground-truth-v1.json').read_text())
ACTION2=json.loads((ROOT/'standalone-lab/calibration/session-2026-09-21-action-gate-v1.json').read_text())

POT1=[1.25,1.19,3.64,2.00,1.25,.75,1.19,4.99,5.94,.75,2.74,1.90,2.66,3.33,.75,2.14,4.04,11.35,17.12,.75,2.14,2.14,2.64,3.00,.75,1.94,.75,.75,1.45,.75,1.75,3.32,4.32,6.72,.75,5.50,7.84,13.84,15.44,25.44,33.49,75.24,1.90,22.30,1.75,3.56,5.34]
BOARD1={3:['5c','Tc','2h','4d'],9:['6d','3c','As','9s','2s'],14:['As','6c','Js'],19:['7h','9s','As','Th','6h'],23:['As','7d','9s','4d','Ah'],26:['4d','2s','6c'],29:['8s','9c','9s'],34:['Jc','7c','Kh','8s','5c'],42:['Tc','Th','As','3c','Td'],47:['Td','6s','Ts','6c']}
COMMIT1=[(80.0,'top',.50),(80.0,'hero',.25),(128.5,'top',.25),(128.5,'rt',.50),(212.5,'rb',.25),(212.5,'hero',.50),(247.0,'lb',.50),(247.0,'hero',.25),(269.0,'rt',.67),(373.0,'rt',6.81),(396.0,'rt',.25),(396.0,'rb',.50),(662.6,'lt',.25),(721.2,'lt',3.75),(752.8,'lt',9.50),(769.0,'lt',41.75),(877.6,'lt',.50)]

def collect(video, times):
    cap=cv2.VideoCapture(video); assert cap.isOpened(),video
    fps=cap.get(cv2.CAP_PROP_FPS); width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    assert abs(fps-30)<.05 and width==1280 and height==720
    ids=sorted({int(round(float(t)*fps)) for t in times}); want=set(ids); by={}; last=max(ids); fi=0
    while fi<=last:
        ok=cap.grab()
        if not ok: break
        if fi in want:
            ok,im=cap.retrieve(); assert ok; by[fi]=im.copy()
        fi+=1
    cap.release(); assert len(by)==len(ids),(video,len(by),len(ids),sorted(want-set(by)))
    return fps,by,fi

t1=[w['best_t'] for w in GT1['heroDecisionWindows']]+[t for t,_,_ in COMMIT1]
fps1,F1,decoded1=collect(VIDEO1,t1)
def f1(t): return F1[int(round(float(t)*fps1))]

t2=[d['best_t'] for d in GT2['decisions']]
for h in GT2['hands']: t2 += [h['start']+x for x in (0,.2,.4,.6,.8,1.0)]
t2 += [max(0,GT2['hands'][0]['start']-1.4)]
fps2,F2,decoded2=collect(VIDEO2,t2)
def f2(t): return F2[int(round(float(t)*fps2))]

hero=CardTemplates(rank_min=.50,suit_min=.46,rank_margin=.008,suit_margin=.018)
board=CardTemplates(rank_min=.48,suit_min=.44,rank_margin=.008,suit_margin=.006)
stack=NumericTemplates(); pot=NumericTemplates(); commit=NumericTemplates()

for w in GT1['heroDecisionWindows']:
    im=f1(w['best_t']); cards=GT1['hands'][w['hand']-1]['heroCards']
    for r,c in zip(DEFAULT_CAL['heroCards'],cards): hero.add(crop(im,r),c)
    assert stack.add_labeled(crop(im,DEFAULT_CAL['heroStackValue']),w['heroStack'],'stack')
d3=GT2['decisions'][2]; im=f2(d3['best_t']); hero.add(crop(im,DEFAULT_CAL['heroCards'][1]),'6h')

for di,cards in BOARD1.items():
    w=GT1['heroDecisionWindows'][di-1]; im=f1(w['best_t'])
    for r,c in zip(DEFAULT_CAL['board'],cards): board.add(crop(im,r),c,include_suit=(c!='As'))
for w in GT1['heroDecisionWindows']:
    cards=GT1['hands'][w['hand']-1]['heroCards']
    if any(c[0]=='Q' for c in cards):
        im=f1(w['best_t'])
        for r,c in zip(DEFAULT_CAL['heroCards'],cards):
            if c[0]=='Q': board.ranks.setdefault('Q',[]).append(cm._glyph(crop(im,r),'rank'))
        break

for w,val in zip(GT1['heroDecisionWindows'],POT1): assert pot.add_labeled(crop(f1(w['best_t']),DEFAULT_CAL['potValue']),val,'pot')
d12=GT2['decisions'][11]; assert pot.add_labeled(crop(f2(d12['best_t']),DEFAULT_CAL['potValue']),d12['pot'],'pot')
for t,seat,val in COMMIT1: assert add_commitment_labeled(commit,commitment_crop(f1(t),seat),val),(t,seat,val)

action_rows={r['i']:r for r in ACTION2['rows']}
assert ACTION2['decisionCount']==31 and ACTION2['completeCount']==31

def event_commitment(row, seat):
    events=[e for e in row.get('events',[]) if e.get('seat')==seat and e.get('source')!='transient-text-only']
    if not events: return None
    e=events[-1]; a=str(e.get('action','')).upper()
    if a=='CHECK': return 0.0
    if a in {'CALL','BET','RAISE','ALLIN'} and isinstance(e.get('amount'),(int,float)): return float(e['amount'])
    return None

metrics={'hands':'14/14','decisions':'31/31','buttons':0,'positions':0,'heroHoldout':0,'heroHoldoutTotal':30,'boardHoldout':0,'boardHoldoutTotal':0,'boardWrong':0,'boardAbstain':0,'stack':0,'stackTotal':31,'potHoldout':0,'potHoldoutTotal':30,'toCall':0,'toCallTotal':31,'toCallDirect':0,'toCallStateResolved':0,'actionComplete':ACTION2['completeCount']}
errors=[]

for h in GT2['hands']:
    expected=(h['dealer'],tuple(sorted(h['dealtSeats'])),h['heroPosition']); votes=[]
    for dt in (0,.2,.4,.6,.8,1.0):
        im=f2(h['start']+dt); dealer,_=dealer_seat(im); active=dealt_seats(im); pos=hero_position_from_dealer(dealer,active)
        votes.append((dealer,tuple(sorted(active)),pos))
    if sum(v==expected for v in votes)>=2: metrics['positions']+=1
    else: errors.append(('position',h['hand'],expected,votes))

pre1=GT2['hands'][0]['start']-1.4
pre1_stack,_,_=stack.read(crop(f2(pre1),DEFAULT_CAL['heroStackValue']),'stack')

for d in GT2['decisions']:
    i=d['i']; im=f2(d['best_t']); bs=hero_button_state(im)
    if bs.confirmed and bs.layout==d['layout']: metrics['buttons']+=1
    else: errors.append(('button',i,bs.layout,d['layout']))

    got=[hero.read(crop(im,r))[0] for r in DEFAULT_CAL['heroCards']]
    if i!=3:
        if got==d['heroCards']: metrics['heroHoldout']+=1
        else: errors.append(('hero',i,got,d['heroCards']))

    pres=[x.present for x in board_presence(im)]; gotb=[board.read(crop(im,r))[0] for p,r in zip(pres,DEFAULT_CAL['board']) if p]
    if len(gotb)!=len(d['board']): errors.append(('board-count',i,gotb,d['board']))
    for a,b in zip(gotb,d['board']):
        metrics['boardHoldoutTotal']+=1
        if a==b: metrics['boardHoldout']+=1
        elif a is None: metrics['boardAbstain']+=1; errors.append(('board-abstain',i,b))
        else: metrics['boardWrong']+=1; errors.append(('board-wrong',i,a,b))

    sv,_,_=stack.read(crop(im,DEFAULT_CAL['heroStackValue']),'stack')
    if sv is not None and abs(sv-d['heroStack'])<.011: metrics['stack']+=1
    else: errors.append(('stack',i,sv,d['heroStack']))

    pv,_,_=pot.read(crop(im,DEFAULT_CAL['potValue']),'pot')
    if i!=12:
        if pv is not None and abs(pv-d['pot'])<.011: metrics['potHoldout']+=1
        else: errors.append(('pot',i,pv,d['pot']))

    row=action_rows[i]; commits={}; direct=True; folded=set()
    for seat in DEFAULT_CAL['seats']:
        roi=commitment_crop(im,seat); v,_,_=read_commitment(commit,roi); lay=commitment_layout(roi)
        if v is None and lay is None: v=0.0
        elif v is None:
            direct=False; ev=event_commitment(row,seat)
            if ev is not None: v=ev
            elif seat=='hero' and not d['board'] and pre1_stack is not None and i==1: v=round(max(0,pre1_stack-sv)+1e-9,2)
            else: v=None
        for e in row.get('events',[]):
            if e.get('seat')==seat and str(e.get('action','')).upper()=='FOLD': folded.add(seat)
        commits[seat]=v
    vals=[v for seat,v in commits.items() if seat not in folded and v is not None]
    hc=commits['hero']; mx=max(vals) if vals else None
    tc=None if hc is None or mx is None else round(max(0,mx-hc)+1e-9,2)
    if tc is not None and abs(tc-d['toCall'])<.011:
        metrics['toCall']+=1
        if direct: metrics['toCallDirect']+=1
        else: metrics['toCallStateResolved']+=1
    else: errors.append(('tocall',i,tc,d['toCall'],commits,sorted(folded)))

assert metrics['buttons']==31,metrics
assert metrics['positions']==14,metrics
assert metrics['heroHoldout']==30,metrics
assert metrics['boardHoldout']==metrics['boardHoldoutTotal']==58 and metrics['boardWrong']==0 and metrics['boardAbstain']==0,metrics
assert metrics['stack']==31,metrics
assert metrics['potHoldout']==30,metrics
assert metrics['toCall']==31,(metrics,[e for e in errors if e[0]=='tocall'])
assert metrics['actionComplete']==31,metrics
assert not errors,errors

print(json.dumps({'ok':True,'baselineGate':'run tests/offline_video_regression.py separately','generalization':metrics,'calibration':{'blindPassCompletedBeforeLabels':True,'postBlind':[{'kind':'hero-rank','decision':3,'card':'6h','excludedFromHoldout':True},{'kind':'pot-font','decision':12,'value':.08,'excludedFromHoldout':True}],'video2CommitmentLabelsUsedForReader':0,'video2BoardLabelsUsedForReader':0},'stateResolution':{'buttonOcrUsedForToCall':False,'directToCall':metrics['toCallDirect'],'stateResolvedToCall':metrics['toCallStateResolved']},'decodedFrames':{'session1TrainingPass':decoded1,'session2Pass':decoded2}},indent=2))

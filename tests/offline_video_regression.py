#!/usr/bin/env python3
import cv2, json, sys
from pathlib import Path
ROOT=Path(__file__).parents[1]
sys.path.insert(0,str(ROOT/'tools'/'offline_vision'))
from pokerstars_offline import *
from pokerstars_commitments import commitment_crop, add_commitment_labeled, read_commitment, commitment_layout
from card_templates import CardTemplates

if len(sys.argv)<2:
    raise SystemExit('usage: python3 tests/offline_video_regression.py "/path/to/session.mkv"')
VIDEO=sys.argv[1]
truth=json.loads((ROOT/'standalone-lab/calibration/session-2026-09-20-ground-truth-v2.json').read_text(encoding='utf-8'))
pos_truth=json.loads((ROOT/'standalone-lab/calibration/hand-positions-ground-truth-v1.json').read_text(encoding='utf-8'))
tc_truth=json.loads((ROOT/'standalone-lab/calibration/tocall-ground-truth-v1.json').read_text(encoding='utf-8'))

cap=cv2.VideoCapture(VIDEO); assert cap.isOpened()
fps=cap.get(cv2.CAP_PROP_FPS); W=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); H=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
assert W==1280 and H==720 and abs(fps-30)<.05
assert truth['handCount']==23 and truth['heroDecisionCount']==47

# All targets are collected in one forward decode. Random CAP_PROP_POS_MSEC seeking
# is deliberately forbidden because it produced a drifting/incorrect V1 timeline.
targets={}
def add(key,t): targets[key]=int(round(float(t)*fps))
for w in truth['heroDecisionWindows']: add(('d',w['i']),w['best_t'])
for h in truth['hands']:
    add(('train',h['hand']),h['start']+1.0)
    for j,dt in enumerate((.5,.8,1.2,1.6)): add(('pos',h['hand'],j),h['start']+dt)
commit_train=[
 (80.0,'top',.50),(80.0,'hero',.25),(128.5,'top',.25),(128.5,'rt',.50),
 (212.5,'rb',.25),(212.5,'hero',.50),(247.0,'lb',.50),(247.0,'hero',.25),
 (269.0,'rt',.67),(373.0,'rt',6.81),(396.0,'rt',.25),(396.0,'rb',.50),
 (662.6,'lt',.25),(721.2,'lt',3.75),(752.8,'lt',9.50),(769.0,'lt',41.75),(877.6,'lt',.50),
]
for t,_,_ in commit_train:add(('committrain',t),t)
idx_to_keys={}
for k,i in targets.items():idx_to_keys.setdefault(i,[]).append(k)
frames={}; max_i=max(idx_to_keys); frame_i=0
while frame_i<=max_i:
    ok,im=cap.read()
    if not ok:break
    if frame_i in idx_to_keys:
        for k in idx_to_keys[frame_i]:frames[k]=im.copy()
    frame_i+=1
decoded_count=frame_i; cap.release()
assert len(frames)==len(targets),(len(frames),len(targets),set(targets)-set(frames))

# Card bank is learned from early hand samples, never from the decision frame under test.
ct=CardTemplates()
for h in truth['hands']:
    im=frames[('train',h['hand'])]
    for r,c in zip(DEFAULT_CAL['heroCards'],h['heroCards']):ct.add(crop(im,r),c)
hero_errors=[]
for w in truth['heroDecisionWindows']:
    expected=truth['hands'][w['hand']-1]['heroCards']; im=frames[('d',w['i'])]
    got=[ct.read(crop(im,r))[0] for r in DEFAULT_CAL['heroCards']]
    if got!=expected:hero_errors.append((w['i'],got,expected))
assert not hero_errors,hero_errors

# Every V2 Hero decision must expose the expected physical PokerStars button layout.
button_errors=[]
for w in truth['heroDecisionWindows']:
    st=hero_button_state(frames[('d',w['i'])])
    if not st.confirmed or st.layout!=w['layout']:button_errors.append((w['i'],st,w['layout']))
assert not button_errors,button_errors

# Position comes from dealer + dealt-in seats near hand start, then is frozen by hand.
pos_errors=[]
for hand,start,dealer_expected,active_expected,pos_expected in pos_truth['rows']:
    expected=(dealer_expected,tuple(sorted(active_expected)),pos_expected); votes=[]
    for j in range(4):
        im=frames[('pos',hand,j)]; dealer,_=dealer_seat(im); active=dealt_seats(im); pos=hero_position_from_dealer(dealer,active)
        votes.append((dealer,tuple(sorted(active)),pos))
    if sum(v==expected for v in votes)<2:pos_errors.append((hand,expected,votes))
assert not pos_errors,pos_errors

# 3-fold stack holdout: each decision's stack is tested against a bank that never
# saw that decision's labeled stack image.
stack_errors=[]
for fold in range(3):
    nt=NumericTemplates()
    for w in truth['heroDecisionWindows']:
        if w['i']%3!=fold:assert nt.add_labeled(crop(frames[('d',w['i'])],DEFAULT_CAL['heroStackValue']),w['heroStack'],'stack')
    assert nt.ready(),(fold,{k:len(v) for k,v in nt.bank.items()})
    for w in truth['heroDecisionWindows']:
        if w['i']%3==fold:
            v,conf,text=nt.read(crop(frames[('d',w['i'])],DEFAULT_CAL['heroStackValue']),'stack')
            if v is None or abs(v-w['heroStack'])>.011:stack_errors.append((fold,w['i'],v,text,w['heroStack'],conf))
assert not stack_errors,stack_errors

# Pot font is calibrated with two hand-verified examples; three independent
# holdouts protect the historical 6/8 -> 0 confusion.
nt=NumericTemplates()
for w in truth['heroDecisionWindows']:assert nt.add_labeled(crop(frames[('d',w['i'])],DEFAULT_CAL['heroStackValue']),w['heroStack'],'stack')
for di,val in {3:3.64,37:7.84}.items():assert nt.add_labeled(crop(frames[('d',di)],DEFAULT_CAL['potValue']),val,'pot')
for di,expected in {13:2.66,23:2.64,38:13.84}.items():
    v,conf,text=nt.read(crop(frames[('d',di)],DEFAULT_CAL['potValue']),'pot')
    assert v is not None and abs(v-expected)<.011,(di,v,text,expected,conf)

# Commitment bank uses independent calibration frames and a dedicated `US$ value`
# layout parser. The 47 physical decision frames are the holdout set.
for t,seat,val in commit_train:
    assert add_commitment_labeled(nt,commitment_crop(frames[('committrain',t)],seat),val),('commit-train',t,seat,val)
tc_errors=[]
for row in tc_truth['rows']:
    di,hand,layout,expected_hero,expected_max,expected_tc=row; im=frames[('d',di)]; commits={}; ambiguous=[]
    for seat in DEFAULT_CAL['seats']:
        roi=commitment_crop(im,seat); v,conf,text=read_commitment(nt,roi); lay=commitment_layout(roi)
        if v is None:
            if lay is None:v=0.0
            else:ambiguous.append(seat)
        commits[seat]=v
    vals=[v for v in commits.values() if v is not None]; hero=commits['hero']; mx=max(vals) if vals else None
    tc=None if hero is None or mx is None else round(max(0,mx-hero)+1e-9,2)
    if ambiguous or tc is None or abs(tc-expected_tc)>.011:tc_errors.append((di,ambiguous,tc,expected_tc,commits))
assert not tc_errors,tc_errors

print(json.dumps({
 'ok':True,'timeline':'sequential-frame-index','framesDecoded':decoded_count,
 'hands':23,'decisions':47,'heroCards':'47/47','buttons':'47/47','positions':'23/23',
 'stackHoldout':'47/47','potHoldout':'3/3','toCall':'47/47'
},indent=2))

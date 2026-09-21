#!/usr/bin/env python3
import cv2, json, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/'tools'/'offline_vision'))
from pokerstars_offline import *

VIDEO=sys.argv[1]
cap=cv2.VideoCapture(VIDEO)
assert cap.isOpened()
assert int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))==1280 and int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))==720
assert abs(cap.get(cv2.CAP_PROP_FPS)-30)<0.05

anchors={240:(2.60,50.69),300:(1.75,49.54),420:(2.14,56.85),600:(0.75,54.35),780:(33.49,42.43)}

# Independent fixed card-slot presence regressions.
im=frame_at(cap,420)
assert [x.present for x in hero_presence(im)]==[True,True]
assert [x.present for x in board_presence(im)]==[True,True,True,True,True]
im=frame_at(cap,600)
assert [x.present for x in hero_presence(im)]==[True,True]
assert [x.present for x in board_presence(im)]==[False,False,False,False,False]
im=frame_at(cap,240)
assert [x.present for x in board_presence(im)]==[True,True,True,False,False]

# Numeric templates are learned only from labeled ROIs in the real session.
nt=NumericTemplates()
for t,(pot,stack) in anchors.items():
    im=frame_at(cap,t)
    assert nt.add_labeled(crop(im,DEFAULT_CAL['potValue']),pot,'pot')
    assert nt.add_labeled(crop(im,DEFAULT_CAL['heroStackValue']),stack,'stack')
commit_anchors=[(300,'lb',0.25),(300,'top',0.50),(600,'hero',0.25),(600,'lb',0.50)]
for t,seat,value in commit_anchors:
    im=frame_at(cap,t)
    assert nt.add_labeled(crop(im,DEFAULT_CAL['seats'][seat]['commit']),value,'pot')
assert nt.ready(), {d:len(v) for d,v in nt.bank.items()}

results=[]
for t,(pot,stack) in anchors.items():
    im=frame_at(cap,t)
    pv,pc,ps=nt.read(crop(im,DEFAULT_CAL['potValue']),'pot')
    sv,sc,ss=nt.read(crop(im,DEFAULT_CAL['heroStackValue']),'stack')
    assert pv is not None and abs(pv-pot)<0.011, (t,'pot',pv,ps,pot,pc)
    assert sv is not None and abs(sv-stack)<0.011, (t,'stack',sv,ss,stack,sc)
    results.append((t,pv,pc,sv,sc))

# Dealer is inferred only from the fixed table geometry, never action text.
for t,expected in [(240,'rt'),(300,'hero'),(420,'top'),(600,'rb'),(780,'lt')]:
    im=frame_at(cap,t); got,center=dealer_seat(im)
    assert got==expected and center is not None, (t,got,center,expected)

# Bet/commitment values use dedicated seat ROIs.
for t,seat,expected in commit_anchors:
    im=frame_at(cap,t); value,conf,text=nt.read(crop(im,DEFAULT_CAL['seats'][seat]['commit']),'pot')
    assert value is not None and abs(value-expected)<0.011 and conf>=0.80, (t,seat,value,text,conf,expected)

# Snapshot validator: no Brain on partial/decode/history/value inconsistencies.
ok=validate_snapshot({'heroCards':['2s','2c'],'board':['As','7d','9s','4d','Ah'],'heroButtons':['check','bet'],'position':'BB','toCall':0,'heroStack':56.85,'actionComplete':True})
assert ok['ok']
bad=validate_snapshot({'heroCards':['2s','2c'],'board':['As','7d','9s',None,'Ah'],'heroButtons':['check'],'position':'BB','toCall':0,'heroStack':56.85,'actionComplete':True})
assert not bad['ok'] and 'board_decode_gap' in bad['errors']
bad2=validate_snapshot({'heroCards':['2s','2c'],'board':[],'heroButtons':['call'],'position':'BTN','toCall':70,'heroStack':50,'actionComplete':False})
assert not bad2['ok'] and 'to_call_inconsistent' in bad2['errors'] and 'action_history_incomplete' in bad2['errors']

# State-delta action inference.
assert infer_action({'cards':True,'commitment':0,'stack':50,'turn':True},{'cards':False,'commitment':0,'stack':50,'turn':False},0)=='fold'
assert infer_action({'cards':True,'commitment':0,'stack':50,'turn':True},{'cards':True,'commitment':0,'stack':50,'turn':False},0)=='check'
assert infer_action({'cards':True,'commitment':.25,'stack':50,'turn':True},{'cards':True,'commitment':1.0,'stack':49.25,'turn':False},1.0)=='call'
assert infer_action({'cards':True,'commitment':.25,'stack':50,'turn':True},{'cards':True,'commitment':2.0,'stack':48.25,'turn':False},1.0)=='raise'
assert infer_action({'cards':True,'commitment':2.0,'stack':5,'turn':True},{'cards':True,'commitment':7.0,'stack':0,'turn':False},7.0)=='all-in'

print(json.dumps({'ok':True,'numeric':results},indent=2))

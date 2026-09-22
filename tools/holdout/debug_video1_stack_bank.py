#!/usr/bin/env python3
from __future__ import annotations
import cv2, json, sys
from pathlib import Path
ROOT=Path.cwd(); sys.path.insert(0,str(ROOT/'tools'/'offline_vision'))
from pokerstars_offline import *
video=sys.argv[1]
gt=json.loads((ROOT/'standalone-lab/calibration/session-2026-09-20-ground-truth-v2.json').read_text())
times={float(w['best_t']) for w in gt['heroDecisionWindows']}
cap=cv2.VideoCapture(video); assert cap.isOpened(); fps=cap.get(cv2.CAP_PROP_FPS)
mapping={int(round(t*fps)):t for t in times}; want=set(mapping); out={}; fi=0; last=max(want)
while fi<=last:
    ok=cap.grab()
    if not ok: break
    if fi in want:
        ok,im=cap.retrieve(); assert ok; out[mapping[fi]]=im.copy()
    fi+=1
cap.release()
print('CV2_VERSION',cv2.__version__,'FPS',fps,'FRAMES_CAPTURED',len(out))
num=NumericTemplates(); bad=[]
for i,w in enumerate(gt['heroDecisionWindows'],1):
    t=float(w['best_t']); roi=crop(out[t],DEFAULT_CAL['heroStackValue']); layout=num._layout(roi,'stack'); masks=num._fixed_masks(roi,layout)
    ok=num.add_labeled(roi,w['heroStack'],'stack')
    if not ok:
        bad.append((i,t,w['heroStack'],layout,len(masks)))
        print('BAD',i,'t',t,'value',w['heroStack'],'layout',layout,'masks',len(masks),'shape',roi.shape)
        if layout:
            print('COMPS',num._components(roi),'COMMA',num._comma_x(roi),'CHAIN',num._numeric_chain(roi))
print('BAD_COUNT',len(bad),'READY',num.ready())
if bad: raise SystemExit(2)

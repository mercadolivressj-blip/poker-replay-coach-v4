#!/usr/bin/env python3
import argparse, cv2, json
from pathlib import Path
from pokerstars_offline import *

ANCHORS={240:{'pot':2.60,'stack':50.69},300:{'pot':1.75,'stack':49.54},420:{'pot':2.14,'stack':56.85},600:{'pot':0.75,'stack':54.35},780:{'pot':33.49,'stack':42.43}}
GOLDEN={240:{'board':['Tc','5d','6d']},420:{'hero':['2s','2c'],'board':['As','7d','9s','4d','Ah']},600:{'hero':['Kc','Qh'],'board':[]}}
COMMITS=[{'t':300,'seat':'lb','value':0.25},{'t':300,'seat':'top','value':0.50},{'t':600,'seat':'hero','value':0.25},{'t':600,'seat':'lb','value':0.50}]

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('video'); ap.add_argument('--out',default='offline-dataset'); ap.add_argument('--step',type=int,default=5); args=ap.parse_args()
    out=Path(args.out); (out/'frames').mkdir(parents=True,exist_ok=True); (out/'rois').mkdir(exist_ok=True)
    cap=cv2.VideoCapture(args.video); fps=cap.get(cv2.CAP_PROP_FPS); n=cap.get(cv2.CAP_PROP_FRAME_COUNT); dur=n/fps
    manifest={'version':'ssj-poker-offline-dataset-v1','video':Path(args.video).name,'width':int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),'height':int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),'fps':fps,'duration':dur,'samplingSeconds':args.step,'anchors':ANCHORS,'goldenFrames':GOLDEN,'commitmentAnchors':COMMITS,'samples':[]}
    for t in range(0,int(dur)+1,args.step):
        im=frame_at(cap,t); p=out/'frames'/f'{t:04d}.jpg'; cv2.imwrite(str(p),im,[cv2.IMWRITE_JPEG_QUALITY,92])
        bp=board_presence(im); hp=hero_presence(im); ds,dc=dealer_seat(im)
        manifest['samples'].append({'t':t,'heroPresence':[x.present for x in hp],'boardPresence':[x.present for x in bp],'dealerSeat':ds,'dealerCenter':dc})
    for t in ANCHORS:
        im=frame_at(cap,t)
        for name,r in [('pot',DEFAULT_CAL['potValue']),('stack',DEFAULT_CAL['heroStackValue'])]: cv2.imwrite(str(out/'rois'/f'{t}_{name}.png'),crop(im,r))
    for row in COMMITS:
        im=frame_at(cap,row['t']); cv2.imwrite(str(out/'rois'/f"{row['t']}_{row['seat']}_commit.png"),crop(im,DEFAULT_CAL['seats'][row['seat']]['commit']))
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps({'duration':dur,'samples':len(manifest['samples']),'out':str(out)},indent=2))

if __name__=='__main__': main()

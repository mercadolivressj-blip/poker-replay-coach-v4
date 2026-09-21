#!/usr/bin/env python3
from __future__ import annotations

import cv2
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path.cwd()
sys.path.insert(0, str(ROOT / 'tools' / 'offline_vision'))

from pokerstars_offline import *
from pokerstars_commitments import commitment_crop, add_commitment_labeled, read_commitment, commitment_layout
from card_templates import CardTemplates
import card_templates as cm

VIDEO1, VIDEO2, VIDEO5, OUT = sys.argv[1:5]

GT1 = json.loads((ROOT / 'standalone-lab/calibration/session-2026-09-20-ground-truth-v2.json').read_text())
GT2 = json.loads((ROOT / 'standalone-lab/calibration/session-2026-09-21-ground-truth-v1.json').read_text())

# Frozen calibration copied verbatim from the proven video-4 source runner.
POT1 = [1.25,1.19,3.64,2.00,1.25,.75,1.19,4.99,5.94,.75,2.74,1.90,2.66,3.33,.75,2.14,4.04,11.35,17.12,.75,2.14,2.14,2.64,3.00,.75,1.94,.75,.75,1.45,.75,1.75,3.32,4.32,6.72,.75,5.50,7.84,13.84,15.44,25.44,33.49,75.24,1.90,22.30,1.75,3.56,5.34]
BOARD1 = {
    3:['5c','Tc','2h','4d'], 9:['6d','3c','As','9s','2s'], 14:['As','6c','Js'],
    19:['7h','9s','As','Th','6h'], 23:['As','7d','9s','4d','Ah'], 26:['4d','2s','6c'],
    29:['8s','9c','9s'], 34:['Jc','7c','Kh','8s','5c'], 42:['Tc','Th','As','3c','Td'],
    47:['Td','6s','Ts','6c']
}
COMMIT1 = [
    (80.0,'top',.50),(80.0,'hero',.25),(128.5,'top',.25),(128.5,'rt',.50),
    (212.5,'rb',.25),(212.5,'hero',.50),(247.0,'lb',.50),(247.0,'hero',.25),
    (269.0,'rt',.67),(373.0,'rt',6.81),(396.0,'rt',.25),(396.0,'rb',.50),
    (662.6,'lt',.25),(721.2,'lt',3.75),(752.8,'lt',9.50),(769.0,'lt',41.75),(877.6,'lt',.50)
]

SEATS = list(DEFAULT_CAL['seats'])
VALID_BOARDS = {0,3,4,5}
STREET_ORDER = {0:0,3:1,4:2,5:3}


def collect(video, times):
    cap = cv2.VideoCapture(video)
    assert cap.isOpened(), video
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    assert width == 1280 and height == 720 and abs(fps - 30) < .05, (video, width, height, fps)
    mapping = {int(round(float(t) * fps)): float(t) for t in times}
    ids = sorted(mapping); want = set(ids); out = {}; fi = 0; last = max(ids) if ids else -1
    while fi <= last:
        ok = cap.grab()
        if not ok: break
        if fi in want:
            ok, im = cap.retrieve(); assert ok
            out[mapping[fi]] = im.copy()
        fi += 1
    cap.release()
    assert len(out) == len(mapping), (video, len(out), len(mapping))
    return out


def build_frozen_banks():
    t1 = {float(w['best_t']) for w in GT1['heroDecisionWindows']}
    for t,_,_ in COMMIT1: t1.add(float(t))
    f1 = collect(VIDEO1, t1)
    t2 = {float(GT2['decisions'][2]['best_t']), float(GT2['decisions'][11]['best_t'])}
    f2 = collect(VIDEO2, t2)

    hero = CardTemplates(rank_min=.50, suit_min=.46, rank_margin=.008, suit_margin=.018)
    board = CardTemplates(rank_min=.48, suit_min=.44, rank_margin=.008, suit_margin=.006)
    stack = NumericTemplates(); pot = NumericTemplates(); commit = NumericTemplates()

    for w in GT1['heroDecisionWindows']:
        im = f1[float(w['best_t'])]
        cards = GT1['hands'][w['hand'] - 1]['heroCards']
        for r,c in zip(DEFAULT_CAL['heroCards'], cards): hero.add(crop(im,r), c)
        assert stack.add_labeled(crop(im, DEFAULT_CAL['heroStackValue']), w['heroStack'], 'stack')

    im = f2[float(GT2['decisions'][2]['best_t'])]
    hero.add(crop(im, DEFAULT_CAL['heroCards'][1]), '6h')

    for di,cards in BOARD1.items():
        w = GT1['heroDecisionWindows'][di - 1]
        im = f1[float(w['best_t'])]
        for r,c in zip(DEFAULT_CAL['board'], cards):
            board.add(crop(im,r), c, include_suit=(c != 'As'))

    for w in GT1['heroDecisionWindows']:
        cards = GT1['hands'][w['hand'] - 1]['heroCards']
        if any(c[0] == 'Q' for c in cards):
            im = f1[float(w['best_t'])]
            for r,c in zip(DEFAULT_CAL['heroCards'], cards):
                if c[0] == 'Q': board.ranks.setdefault('Q', []).append(cm._glyph(crop(im,r), 'rank'))
            break

    for w,val in zip(GT1['heroDecisionWindows'], POT1):
        assert pot.add_labeled(crop(f1[float(w['best_t'])], DEFAULT_CAL['potValue']), val, 'pot')
    assert pot.add_labeled(crop(f2[float(GT2['decisions'][11]['best_t'])], DEFAULT_CAL['potValue']), GT2['decisions'][11]['pot'], 'pot')
    for t,s,v in COMMIT1:
        assert add_commitment_labeled(commit, commitment_crop(f1[float(t)], s), v)

    assert stack.ready() and pot.ready() and commit.ready()
    return hero, board, stack, pot, commit


hero_reader, board_reader, stack_reader, pot_reader, commit_reader = build_frozen_banks()


def round2(v):
    return None if v is None else round(float(v) + 1e-9, 2)


def seat_cards_present(im, seat):
    row = DEFAULT_CAL['seats'][seat]
    return seat_dealt_in(crop(im, row['cards']), hero=(seat == 'hero'))


def read_hero(im):
    pres = hero_presence(im)
    if not all(x.present for x in pres): return None
    cards = [hero_reader.read(crop(im,r))[0] for r in DEFAULT_CAL['heroCards']]
    return cards if all(cards) else None


def read_board(im):
    pres = board_presence(im)
    flags = [x.present for x in pres]
    n = sum(flags)
    if n not in VALID_BOARDS: return None, n, flags
    if flags != ([True] * n + [False] * (5 - n)):
        return None, n, flags
    cards = [board_reader.read(crop(im,r))[0] for p,r in zip(flags, DEFAULT_CAL['board']) if p]
    if any(c is None for c in cards): return None, n, flags
    return cards, n, flags


def money_snapshot(im):
    sv, ss, _ = stack_reader.read(crop(im, DEFAULT_CAL['heroStackValue']), 'stack')
    pv, ps, _ = pot_reader.read(crop(im, DEFAULT_CAL['potValue']), 'pot')
    return round2(sv), round2(pv), float(ss), float(ps)


def fresh_commitments(im, hand, t):
    resolved = {}; direct = {}; sources = {}; ambiguous = []
    street = hand['street'] if hand else 0
    for seat in SEATS:
        roi = commitment_crop(im, seat)
        v, sc, txt = read_commitment(commit_reader, roi)
        lay = commitment_layout(roi)
        if v is not None:
            v = round2(v); resolved[seat] = v; direct[seat] = v; sources[seat] = 'direct'
            if hand is not None: hand['commitLedger'][seat] = (street, v, t)
        elif lay is None:
            resolved[seat] = 0.0; direct[seat] = 0.0; sources[seat] = 'empty'
            if hand is not None: hand['commitLedger'][seat] = (street, 0.0, t)
        else:
            direct[seat] = None
            old = hand['commitLedger'].get(seat) if hand is not None else None
            if old and old[0] == street and t - old[2] <= 3.0:
                resolved[seat] = old[1]; sources[seat] = 'persisted'
            else:
                resolved[seat] = None; sources[seat] = 'BLOCK'; ambiguous.append(seat)
    return resolved, direct, sources, ambiguous


def add_event(hand, t, seat, action, amount=None, source='state'):
    if hand is None: return
    if hand['events']:
        e = hand['events'][-1]
        if e['seat'] == seat and e['action'] == action and abs(e['t'] - t) < .35 and e.get('amount') == amount:
            return
    hand['events'].append({'t':round(t,3),'seat':seat,'action':action,'amount':amount,'source':source,'street':hand['street']})
    hand['lastEventT'][seat] = t


def finalize_turn(hand, t, seat, commits, present_now):
    if hand is None or seat is None: return
    info = hand.get('turnInfo')
    if not info or info['seat'] != seat: return
    if hand['lastEventT'].get(seat, -1e9) >= info['startT'] - .05:
        return
    pc = commits.get(seat)
    vals = [v for v in commits.values() if v is not None]
    table_max = max(vals) if vals else 0.0
    if seat not in present_now:
        add_event(hand, t, seat, 'FOLD', source='turn-end')
        hand['active'].discard(seat)
    elif pc is not None and pc >= table_max - .02:
        add_event(hand, t, seat, 'CHECK', source='turn-end')
    else:
        hand['unresolved'].append({'t':round(t,3),'seat':seat,'reason':'turn-ended-without-resolved-action','street':hand['street']})


def new_hand(hid, t, cards):
    return {
        'id':hid, 'startT':round(t,3), 'endT':None, 'heroCards':list(cards), 'dealer':None,
        'dealtSeats':None, 'position':None, 'positionVotes':Counter(), 'street':0,
        'streetCandidate':0, 'streetCandidateN':0, 'boardTransitions':[0], 'commitLedger':{},
        'prevCommits':{s:0.0 for s in SEATS}, 'active':set(), 'prevPresent':set(),
        'events':[], 'unresolved':[], 'lastEventT':{}, 'stableTurn':None,
        'turnCandidate':None, 'turnCandidateN':0, 'turnInfo':None, 'heroTurnEpoch':0,
        'cardDecodeMismatches':0, 'invalidBoardSamples':0, 'decisionIds':[]
    }


def position_observe(hand, dealer, dealt, pos):
    if hand is None or pos is None or dealer is None or 'hero' not in dealt: return
    key = (dealer, tuple(dealt), pos)
    hand['positionVotes'][key] += 1
    if hand['position'] is None:
        best, n = hand['positionVotes'].most_common(1)[0]
        if n >= 2:
            hand['dealer'], ds, hand['position'] = best
            hand['dealtSeats'] = list(ds)
            hand['active'] = set(ds)


def street_observe(hand, n):
    if hand is None or n not in VALID_BOARDS: return False
    if hand['streetCandidate'] == n: hand['streetCandidateN'] += 1
    else: hand['streetCandidate'] = n; hand['streetCandidateN'] = 1
    if hand['streetCandidateN'] < 2 or n == hand['street']: return False
    if STREET_ORDER[n] < STREET_ORDER[hand['street']]:
        hand['invalidBoardSamples'] += 1
        return False
    hand['street'] = n
    hand['boardTransitions'].append(n)
    hand['commitLedger'].clear()
    hand['prevCommits'] = {s:0.0 for s in SEATS}
    hand['stableTurn'] = None; hand['turnCandidate'] = None; hand['turnCandidateN'] = 0; hand['turnInfo'] = None
    return True


def turn_observe(hand, t, raw_turn, commits, present_now):
    if hand is None: return
    if raw_turn == hand['turnCandidate']: hand['turnCandidateN'] += 1
    else: hand['turnCandidate'] = raw_turn; hand['turnCandidateN'] = 1
    if hand['turnCandidateN'] < 2 or raw_turn == hand['stableTurn']: return
    old = hand['stableTurn']
    if old is not None: finalize_turn(hand, t, old, commits, present_now)
    hand['stableTurn'] = raw_turn
    if raw_turn == 'hero': hand['heroTurnEpoch'] += 1
    hand['turnInfo'] = None if raw_turn is None else {'seat':raw_turn,'startT':t,'commit':commits.get(raw_turn),'eventIndex':len(hand['events'])}


def action_observe(hand, t, commits, present_now):
    if hand is None: return
    prev = hand['prevCommits']
    prev_vals = [v for v in prev.values() if v is not None]
    prev_max = max(prev_vals) if prev_vals else 0.0
    for seat in SEATS:
        pc = prev.get(seat); cc = commits.get(seat)
        if pc is None or cc is None: continue
        if cc > pc + .02:
            # Skip initial forced blinds before observed voluntary action.
            forced_window = (hand['street'] == 0 and t - hand['startT'] < 1.2 and hand['stableTurn'] is None)
            if not forced_window:
                if hand['street'] > 0 and prev_max <= .02:
                    kind = 'BET'
                else:
                    kind = 'RAISE' if cc > prev_max + .02 else 'CALL'
                add_event(hand, t, seat, kind, round2(cc), 'commitment')
    # Conservative fast-fold recovery.
    for seat in list(hand['active']):
        if seat in present_now: continue
        pc = prev.get(seat) or 0.0
        owed = max(0.0, prev_max - pc)
        recent_turn = hand['stableTurn'] == seat or (hand.get('turnInfo') and hand['turnInfo']['seat'] == seat and t - hand['turnInfo']['startT'] < 1.2)
        if owed > .02 or recent_turn:
            add_event(hand, t, seat, 'FOLD', source='card-disappearance')
            hand['active'].discard(seat)
    hand['prevCommits'] = dict(commits)
    hand['prevPresent'] = set(present_now)


def decision_snapshot(im, t, hand, commits, sources, ambiguous, bs):
    cards = read_hero(im)
    board, board_n, flags = read_board(im)
    stack, pot, stack_sc, pot_sc = money_snapshot(im)
    vals = [v for v in commits.values() if v is not None]
    hc = commits.get('hero')
    raw_tc = None if hc is None or not vals else round2(max(0.0, max(vals) - hc))
    tc = raw_tc
    capped = False
    if tc is not None and stack is not None and tc > stack + .001:
        tc = stack; capped = True
    pos = hand['position'] if hand else None
    history_complete = bool(hand is not None and not hand['unresolved'])
    snap = {
        't':round(t,3), 'hand':hand['id'] if hand else None, 'heroCards':cards,
        'board':board, 'boardPresenceCount':board_n, 'boardPresenceFlags':flags,
        'heroStack':stack, 'pot':pot, 'toCall':tc, 'rawToCall':raw_tc, 'allInCapApplied':capped,
        'commitments':{k:round2(v) for k,v in commits.items()}, 'commitmentSources':sources,
        'ambiguousCommitments':list(ambiguous), 'position':pos, 'buttonLayout':bs.layout,
        'heroButtons':list(bs.actions), 'heroTurnConfirmed':bool(bs.confirmed),
        'heroPresence':'present' if cards else 'missing', 'actionComplete':history_complete,
        'unresolvedBeforeDecision':len(hand['unresolved']) if hand else None,
        'heroTurnEpoch':hand['heroTurnEpoch'] if hand else None,
        'stackScore':round(stack_sc,4), 'potScore':round(pot_sc,4),
        'buttonStrength':round(bs.blue_ratio + bs.green_ratio + bs.orange_ratio,4)
    }
    gate = validate_snapshot(snap)
    extra = []
    if cards and len(set(cards)) != 2: extra.append('hero_cards_not_unique')
    if board and len(set(board)) != len(board): extra.append('board_cards_not_unique')
    if cards and board and set(cards) & set(board): extra.append('hero_board_card_collision')
    if ambiguous: extra.append('commitment_ambiguity')
    if gate['ok'] and extra: gate = {'ok':False,'errors':extra}
    elif extra: gate['errors'].extend(extra)
    snap['brainGate'] = gate
    return snap


def snap_signature(s):
    return (
        tuple(s.get('heroCards') or []), tuple(s.get('board') or []), s.get('heroStack'), s.get('pot'),
        s.get('toCall'), s.get('position'), s.get('buttonLayout'), tuple(sorted(s.get('ambiguousCommitments') or []))
    )


cap = cv2.VideoCapture(VIDEO5)
assert cap.isOpened(), VIDEO5
fps = float(cap.get(cv2.CAP_PROP_FPS)); width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)); frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
assert width == 1280 and height == 720 and abs(fps - 30) < .05, (width,height,fps)

sample_step = 3
fi = -1
hands = []
current = None
candidate_cards = None; candidate_n = 0; candidate_dealer = None
absence_samples = 999; absence_started_t = 0.0
hand_id = 0
open_decision = None
decisions = []
discarded_windows = []
raw_critical = []


def finalize_decision():
    global open_decision
    if open_decision is None: return
    w = open_decision; open_decision = None
    if w['samples'] < 2:
        discarded_windows.append({'startT':round(w['startT'],3),'lastT':round(w['lastT'],3),'samples':w['samples'],'reason':'single-sample-button-window'})
        return
    d = dict(w['best'])
    d['i'] = len(decisions) + 1
    d['windowStartT'] = round(w['startT'],3); d['windowEndT'] = round(w['lastT'],3); d['windowSamples'] = w['samples']
    sig, n = w['signatures'].most_common(1)[0]
    d['windowConsensus'] = round(n / w['samples'], 4)
    d['windowUniqueSignatures'] = len(w['signatures'])
    decisions.append(d)
    if d['hand'] is not None:
        for h in hands:
            if h['id'] == d['hand']:
                h['decisionIds'].append(d['i']); break


def evidence_score(s):
    score = 0.0
    score += 100.0 if s['brainGate']['ok'] else 0.0
    for k in ('heroCards','board','heroStack','pot','toCall','position','buttonLayout'):
        if s.get(k) is not None: score += 4.0
    score -= 7.0 * len(s.get('ambiguousCommitments') or [])
    score -= 8.0 * (s.get('unresolvedBeforeDecision') or 0)
    score += s.get('buttonStrength',0)
    return score

while True:
    ok = cap.grab()
    if not ok: break
    fi += 1
    if fi % sample_step != 0: continue
    ok, im = cap.retrieve()
    if not ok: break
    t = fi / fps

    hp = hero_presence(im)
    visible = all(x.present for x in hp)
    cards = read_hero(im) if visible else None
    dealer_now, _ = dealer_seat(im) if visible else (None, None)

    if not visible or cards is None:
        if absence_samples == 0: absence_started_t = t
        absence_samples += 1
        candidate_cards = None; candidate_n = 0; candidate_dealer = None
    else:
        key = tuple(cards)
        need_new = current is None
        if current is not None:
            long_absence = absence_samples >= 5
            dealer_rotated = bool(dealer_now and current.get('dealer') and dealer_now != current.get('dealer'))
            cards_changed = key != tuple(current['heroCards'])
            need_new = cards_changed or (long_absence and (dealer_rotated or t - absence_started_t >= 2.0))
            if not need_new and cards_changed:
                current['cardDecodeMismatches'] += 1
        if need_new:
            if candidate_cards == key:
                candidate_n += 1
            else:
                candidate_cards = key; candidate_n = 1; candidate_dealer = dealer_now
            required = 3 if (current is None or absence_samples >= 5) else 5
            if candidate_n >= required:
                finalize_decision()
                if current is not None: current['endT'] = round(t,3)
                hand_id += 1
                current = new_hand(hand_id, t, key)
                hands.append(current)
                candidate_cards = None; candidate_n = 0
        else:
            candidate_cards = None; candidate_n = 0
        absence_samples = 0

    board_flags = board_presence(im)
    board_n_raw = sum(x.present for x in board_flags)
    if current is not None:
        if board_n_raw not in VALID_BOARDS: current['invalidBoardSamples'] += 1
        street_observe(current, board_n_raw)

    dealt_now = set(dealt_seats(im)) if current is not None else set()
    if current is not None and visible and current['position'] is None:
        pos = hero_position_from_dealer(dealer_now, list(dealt_now))
        position_observe(current, dealer_now, [s for s in CLOCKWISE_SEATS if s in dealt_now], pos)

    commits, direct_commits, commit_sources, ambiguous = fresh_commitments(im, current, t)
    if current is not None:
        raw_turn, _ = turn_seat(im)
        turn_observe(current, t, raw_turn, commits, dealt_now)
        action_observe(current, t, commits, dealt_now)

    bs = hero_button_state(im)
    if bs.confirmed:
        snap = decision_snapshot(im, t, current, commits, commit_sources, ambiguous, bs)
        key = (snap.get('hand'), snap.get('heroTurnEpoch'))
        if open_decision is not None:
            oldkey = (open_decision['best'].get('hand'), open_decision['best'].get('heroTurnEpoch'))
            if key != oldkey and snap.get('heroTurnEpoch') not in (None,0): finalize_decision()
        if open_decision is None:
            open_decision = {'startT':t,'lastT':t,'samples':0,'best':snap,'bestScore':-1e9,'signatures':Counter()}
        open_decision['lastT'] = t; open_decision['samples'] += 1; open_decision['signatures'][snap_signature(snap)] += 1
        sc = evidence_score(snap)
        if sc > open_decision['bestScore']:
            open_decision['bestScore'] = sc; open_decision['best'] = snap
    elif open_decision is not None and t - open_decision['lastT'] > .8:
        finalize_decision()

finalize_decision()
cap.release()
if current is not None: current['endT'] = round(frames / fps, 3)

# Associate each physical Hero decision with the resulting Hero action.
for idx,d in enumerate(decisions):
    h = next((x for x in hands if x['id'] == d['hand']), None)
    if h is None:
        d['heroAction'] = None; continue
    next_t = h['endT'] or 1e12
    for d2 in decisions[idx+1:]:
        if d2['hand'] == d['hand']:
            next_t = d2['t']; break
        if d2['hand'] != d['hand']: break
    ev = next((e for e in h['events'] if e['seat'] == 'hero' and e['t'] >= d['t'] - .05 and e['t'] < next_t), None)
    d['heroAction'] = ev

# Convert hand internals to JSON-friendly output and compute continuity.
hand_out = []
continuity_ok = 0
for h in hands:
    pos_votes = [{'dealer':k[0],'dealtSeats':list(k[1]),'position':k[2],'votes':v} for k,v in h['positionVotes'].most_common()]
    hd = {
        'id':h['id'],'startT':h['startT'],'endT':h['endT'],'heroCards':h['heroCards'],'dealer':h['dealer'],
        'dealtSeats':h['dealtSeats'],'position':h['position'],'positionVotes':pos_votes,'boardTransitions':h['boardTransitions'],
        'invalidBoardSamples':h['invalidBoardSamples'],'cardDecodeMismatches':h['cardDecodeMismatches'],
        'decisionIds':h['decisionIds'],'events':h['events'],'unresolved':h['unresolved']
    }
    hdec = [d for d in decisions if d['hand'] == h['id']]
    hd['continuityOk'] = bool(h['position'] and h['heroCards'] and all(d.get('heroAction') is not None for d in hdec) and all(d['unresolvedBeforeDecision'] == 0 for d in hdec) and h['boardTransitions'] == sorted(set(h['boardTransitions']), key=lambda x:STREET_ORDER[x]))
    continuity_ok += int(hd['continuityOk'])
    hand_out.append(hd)

block_reasons = Counter()
for d in decisions:
    for e in d['brainGate']['errors']: block_reasons[e] += 1

summary = {
    'sourceReaderHead':'cdecb04b6230a343535fcca5129a14a5579ea44f',
    'calibrationPolicy':'sessions 1-2 frozen only; video5 contributes zero templates/labels/thresholds',
    'video5':{'width':width,'height':height,'fps':fps,'frames':frames,'durationSec':round(frames/fps,3),'sampleStepFrames':sample_step},
    'handsDetected':len(hands),
    'heroDecisionsDetected':len(decisions),
    'buttonsConfirmed':sum(1 for d in decisions if d['buttonLayout']),
    'heroCardsComplete':sum(1 for d in decisions if d['heroCards'] and len(d['heroCards'])==2),
    'boardComplete':sum(1 for d in decisions if d['board'] is not None and d['boardPresenceCount'] in VALID_BOARDS),
    'heroStackComplete':sum(1 for d in decisions if d['heroStack'] is not None),
    'potComplete':sum(1 for d in decisions if d['pot'] is not None),
    'toCallComplete':sum(1 for d in decisions if d['toCall'] is not None and not d['ambiguousCommitments']),
    'positionComplete':sum(1 for d in decisions if d['position'] is not None),
    'historyComplete':sum(1 for d in decisions if d['unresolvedBeforeDecision']==0),
    'brainValidDecisions':sum(1 for d in decisions if d['brainGate']['ok']),
    'heroActionAfterDecision':sum(1 for d in decisions if d.get('heroAction') is not None),
    'handContinuity':f'{continuity_ok}/{len(hands)}',
    'allInCapsApplied':sum(1 for d in decisions if d['allInCapApplied']),
    'unstableDecisionWindows':sum(1 for d in decisions if d['windowConsensus'] < .60),
    'discardedButtonWindows':len(discarded_windows),
    'blockReasons':dict(block_reasons),
    'criticalInternalInconsistencies':len(raw_critical),
}

result = {'summary':summary,'decisions':decisions,'hands':hand_out,'discardedButtonWindows':discarded_windows,'criticalInternal':raw_critical}
Path(OUT).write_text(json.dumps(result, indent=2), encoding='utf-8')
print('VIDEO5_BLIND_SUMMARY=' + json.dumps(summary, separators=(',',':')))
for d in decisions:
    print('VIDEO5_DECISION=' + json.dumps({
        'i':d['i'],'t':d['t'],'hand':d['hand'],'heroCards':d['heroCards'],'board':d['board'],'stack':d['heroStack'],'pot':d['pot'],
        'toCall':d['toCall'],'position':d['position'],'layout':d['buttonLayout'],'brainOk':d['brainGate']['ok'],
        'errors':d['brainGate']['errors'],'consensus':d['windowConsensus'],'heroAction':None if d.get('heroAction') is None else d['heroAction']['action']
    }, separators=(',',':')))

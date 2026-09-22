#!/usr/bin/env python3
"""Frozen PokerStars V11 offline scanner.

The first two recordings are calibration-only.  The third recording is always
treated as the target and contributes no templates, labels, or thresholds.
"""
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

if len(sys.argv) != 5:
    raise SystemExit(
        'usage: pokerstars_v11_scanner.py CALIBRATION_1 CALIBRATION_2 TARGET OUT_JSON'
    )

CALIBRATION_VIDEO1, CALIBRATION_VIDEO2, TARGET_VIDEO, OUT = sys.argv[1:5]

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
    f1 = collect(CALIBRATION_VIDEO1, t1)
    t2 = {float(GT2['decisions'][2]['best_t']), float(GT2['decisions'][11]['best_t'])}
    f2 = collect(CALIBRATION_VIDEO2, t2)

    hero = CardTemplates(rank_min=.50, suit_min=.46, rank_margin=.008, suit_margin=.018)
    board = CardTemplates(rank_min=.48, suit_min=.44, rank_margin=.008, suit_margin=.006)
    stack = NumericTemplates(); pot = NumericTemplates(); commit = NumericTemplates()

    for w in GT1['heroDecisionWindows']:
        im = f1[float(w['best_t'])]
        cards = GT1['hands'][w['hand'] - 1]['heroCards']
        for r,c in zip(DEFAULT_CAL['heroCards'], cards): hero.add(crop(im,r), c)
        stack.add_labeled(crop(im, DEFAULT_CAL['heroStackValue']), w['heroStack'], 'stack')

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
        pot.add_labeled(crop(f1[float(w['best_t'])], DEFAULT_CAL['potValue']), val, 'pot')
    pot.add_labeled(crop(f2[float(GT2['decisions'][11]['best_t'])], DEFAULT_CAL['potValue']), GT2['decisions'][11]['pot'], 'pot')
    for t,s,v in COMMIT1:
        add_commitment_labeled(commit, commitment_crop(f1[float(t)], s), v)

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


def read_seat_stacks(im):
    out = {}
    for seat, row in DEFAULT_CAL['seats'].items():
        v, sc, _ = stack_reader.read(crop(im, row['stack']), 'stack')
        out[seat] = round2(v) if v is not None else None
    return out


def table_scene_valid(im):
    x, y, w, h = DEFAULT_CAL['table']
    roi = im[y:y+h, x:x+w]
    if roi.size == 0:
        return False
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    green = cv2.inRange(hsv, (30, 50, 25), (95, 255, 255))
    return (float(cv2.countNonZero(green)) / float(green.size)) >= 0.35


def showdown_visible(im, hand):
    if hand is None or hand.get('street') != 5:
        if hand is not None:
            hand['showdownVotes'] = 0
        return False

    active = set(hand.get('active') or [])
    river_events = [e for e in (hand.get('events') or []) if e.get('street') == 5]
    if not river_events:
        hand['showdownVotes'] = 0
        return False
    if 'hero' in active and not any(e.get('seat') == 'hero' for e in river_events):
        hand['showdownVotes'] = 0
        return False
    if hand.get('stableTurn') is not None:
        hand['showdownVotes'] = 0
        return False

    faceup = False
    for seat in active:
        if seat == 'hero':
            continue
        row = DEFAULT_CAL['seats'][seat]
        if seat_dealt_in(crop(im, row['cards']), hero=True):
            faceup = True
            break
    if faceup:
        hand['showdownVotes'] = int(hand.get('showdownVotes', 0)) + 1
    else:
        hand['showdownVotes'] = 0
    return hand['showdownVotes'] >= 5


def set_terminal(hand, t, reason):
    if hand is None or hand.get('terminal'):
        return
    hand['terminal'] = True
    hand['terminalT'] = round(float(t), 3)
    hand['terminalReason'] = reason
    hand['stableTurn'] = None
    hand['turnInfo'] = None
    hand['turnCandidate'] = None
    hand['turnCandidateN'] = 0


def ledger_semantic_errors(hand):
    if hand is None:
        return ['missing_hand']
    errs = []
    folded = set()
    checked = set()
    events = hand.get('events') or []
    for i, e in enumerate(events):
        seat = e.get('seat'); street = e.get('street'); action = e.get('action')
        key = (street, seat)
        if seat in folded:
            errs.append(f'action_after_fold:{seat}:s{street}:{action}')
        if action == 'FOLD':
            if seat in folded:
                errs.append(f'duplicate_fold:{seat}:s{street}')
            folded.add(seat)
        if action == 'CHECK':
            if key in checked:
                errs.append(f'duplicate_check:{seat}:s{street}')
            checked.add(key)
        if action == 'BET' and key in checked:
            errs.append(f'check_then_bet:{seat}:s{street}')
        if action == 'RAISE' and i:
            prev = events[i-1]
            if (prev.get('action') == 'RAISE' and prev.get('street') == street and
                prev.get('seat') != seat and prev.get('amount') == e.get('amount') and
                abs(float(prev.get('t', 0)) - float(e.get('t', 0))) <= 0.15):
                errs.append(f'equal_simultaneous_raises:s{street}:{e.get("amount")}')
    return errs


def reconcile_unresolved(hand, t, seat, street):
    if hand is None:
        return
    kept = []
    for u in hand['unresolved']:
        same = u.get('seat') == seat and u.get('street') == street
        later = float(t) >= float(u.get('t', t)) - 0.05
        if same and later:
            continue
        kept.append(u)
    hand['unresolved'] = kept


def mark_unresolved(hand, t, seat, reason, start_commit=None, target=None):
    if hand is None or seat is None:
        return
    street = hand['street']
    for u in hand['unresolved']:
        if u.get('seat') == seat and u.get('street') == street:
            return
    owed = None
    if start_commit is not None and target is not None:
        owed = round2(max(0.0, float(target) - float(start_commit)))
    hand['unresolved'].append({
        't': round(t, 3), 'seat': seat, 'reason': reason, 'street': street,
        'startCommit': round2(start_commit), 'target': round2(target), 'owed': owed,
        'presentVotes': 0, 'absentVotes': 0,
    })


def resolve_pending(hand, t, commits, present_now):
    if hand is None or hand.get('terminal') or not hand['unresolved']:
        return
    current_street = hand['street']
    for u in list(hand['unresolved']):
        seat = u.get('seat'); us = u.get('street')
        if seat is None or us is None:
            continue

        # If a normal fold/action already removed this player, that event is the
        # reconciliation. Do not let a stale turn candidate create another fold.
        if hand.get('dealtSeats') and seat not in hand['active']:
            if any(e.get('seat') == seat and e.get('street') == us and e.get('action') == 'FOLD' for e in hand['events']):
                reconcile_unresolved(hand, t, seat, us)
            continue

        if seat in present_now:
            u['presentVotes'] = int(u.get('presentVotes', 0)) + 1
            u['absentVotes'] = 0
        else:
            u['absentVotes'] = int(u.get('absentVotes', 0)) + 1
            u['presentVotes'] = 0

        if us == current_street and u['absentVotes'] >= 5 and float(t) - float(hand['startT']) >= 1.5:
            add_event(hand, t, seat, 'FOLD', source='pending-stable-disappearance')
            hand['active'].discard(seat)
            if hand.get('dealtSeats') and len(hand['active']) <= 1:
                set_terminal(hand, t, 'single-player-remains')
            continue

        if us != current_street:
            target = u.get('target')
            closed_max = hand.get('closedStreetMax', {}).get(us)
            if closed_max is None:
                observed = [e.get('amount') for e in hand.get('events', [])
                            if e.get('street') == us and e.get('amount') is not None]
                closed_max = max(observed) if observed else None
            if target is not None and closed_max is not None and float(closed_max) <= float(target) + 0.02:
                add_event_for_street(hand, t, seat, 'CALL', us, round2(target), 'street-survival')
            continue

        if u['presentVotes'] < 8:
            continue

        start_commit = u.get('startCommit')
        target = u.get('target')
        owed = u.get('owed')
        active_vals = [v for s,v in commits.items() if v is not None and s in hand['active']]
        now_max = max(active_vals) if active_vals else 0.0

        if us == current_street:
            cur = commits.get(seat)
            if start_commit is not None and target is not None and cur is not None and round2(cur) > round2(start_commit):
                if cur > float(target) + 0.02:
                    kind = 'RAISE' if not (current_street > 0 and float(target) <= 0.02) else 'BET'
                else:
                    kind = 'CALL'
                add_event(hand, t, seat, kind, round2(cur), 'pending-commitment')
                continue

            if owed is not None and round2(owed) == 0.0:
                if current_street == 0:
                    # After a voluntary preflop raise there is no legal CHECK;
                    # a zero-owed turn-band sample here is a phantom transition.
                    had_raise = any(e.get('street') == 0 and e.get('action') == 'RAISE' and e.get('t', 0) <= u.get('t', t) + .05 for e in hand['events'])
                    if had_raise or now_max > 0.05 + 0.02:
                        reconcile_unresolved(hand, t, seat, us)
                    else:
                        add_event(hand, t, seat, 'CHECK', source='pending-presence')
                else:
                    add_event(hand, t, seat, 'CHECK', source='pending-presence')
            continue

        # Closed-street survivor proof. Only backfill CALL when the final max on
        # the closed street never exceeded the amount faced, which rules out an
        # unseen raise. Zero-owed postflop actions are CHECKs. Preflop phantom
        # zero-owed turns after a raise are simply reconciled without an event.
        closed_max = hand.get('closedStreetMax', {}).get(us)
        if owed is not None and round2(owed) == 0.0:
            if us == 0 and any(e.get('street') == 0 and e.get('action') == 'RAISE' and e.get('t', 0) <= u.get('t', t) + .05 for e in hand['events']):
                reconcile_unresolved(hand, t, seat, us)
            else:
                add_event_for_street(hand, t, seat, 'CHECK', us, None, 'street-survival')
        elif target is not None and closed_max is not None and float(closed_max) <= float(target) + 0.02:
            add_event_for_street(hand, t, seat, 'CALL', us, round2(target), 'street-survival')

def add_event_for_street(hand, t, seat, action, street, amount=None, source='state'):
    if hand is None or hand.get('terminal'):
        return
    same = [e for e in hand['events'] if e.get('seat') == seat and e.get('street') == street]
    if action == 'CHECK' and any(e.get('action') == 'CHECK' for e in same):
        reconcile_unresolved(hand, t, seat, street)
        return
    if action == 'FOLD' and any(e.get('action') == 'FOLD' for e in same):
        reconcile_unresolved(hand, t, seat, street)
        return
    if action == 'BET' and any(e.get('action') == 'CHECK' for e in same):
        hand['events'] = [e for e in hand['events'] if not (e.get('seat') == seat and e.get('street') == street and e.get('action') == 'CHECK')]
    et = round(float(t) - 0.001, 3)
    hand['events'].append({'t':et,'seat':seat,'action':action,'amount':amount,'source':source,'street':street})
    hand['events'].sort(key=lambda e: (e['t'], e['street']))
    reconcile_unresolved(hand, t, seat, street)

def commitment_prefix_present(roi):
    """Independent presence test for a PokerStars US$ commitment row.

    This intentionally does not decode the amount. It only proves that a
    currency row is visible, so a failed numeric decode cannot be rewritten as
    an empty commitment.
    """
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    sat, val = hsv[:, :, 1], hsv[:, :, 2]
    bw = (((sat < 155) & (val > 80)).astype('uint8')) * 255
    found = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = found[0] if len(found) == 2 else found[1]
    glyphs = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        ink = int(cv2.countNonZero(bw[y:y+h, x:x+w]))
        if 7 <= h <= 16 and w <= 12 and ink >= 10:
            glyphs.append((x, y, w, h, ink))
    glyphs.sort(key=lambda b: b[0])
    for i in range(max(0, len(glyphs) - 2)):
        a, b, c = glyphs[i:i+3]
        if max(a[1], b[1], c[1]) - min(a[1], b[1], c[1]) > 4:
            continue
        g1 = b[0] - (a[0] + a[2])
        g2 = c[0] - (b[0] + b[2])
        if g1 > 5 or g2 > 5:
            continue
        # A fourth aligned glyph at a currency-prefix-sized gap proves there is
        # a value row even when the fixed ROI clips the amount tail.
        for d in glyphs[i+3:]:
            gap = d[0] - (c[0] + c[2])
            if gap < 3:
                continue
            if gap > 16:
                break
            if abs(d[1] - c[1]) <= 4:
                return True
    return False


def commitment_text(chars, layout):
    nint = int(layout.get('nint') or 0)
    if layout.get('decimal'):
        return ''.join(chars[:nint]) + ',' + ''.join(chars[nint:])
    return ''.join(chars)


def repair_commitment_geometry(chars, boxes):
    """Repair PokerStars' wide 4 that the frozen bank can confuse with 1."""
    out = []
    for ch, box in zip(chars, boxes):
        out.append('4' if ch == '1' and int(box[2]) >= 7 else ch)
    return out


def relaxed_commitment_chars(nt, roi, layout):
    """Decode only complete, strong rows rejected by a narrow margin tie."""
    boxes = layout.get('boxes') or []
    if not boxes:
        return None, 0.0
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    sat, val = hsv[:, :, 1], hsv[:, :, 2]
    bw = (((sat < 155) & (val > 80)).astype('uint8')) * 255
    chars = []; scores = []; margins = []
    for x, y, w, h, *_ in boxes:
        mask = bw * 0
        mask[y:y+h, x:x+w] = bw[y:y+h, x:x+w]
        ch, score, margin = nt.classify_digit(mask)
        chars.append(ch); scores.append(float(score)); margins.append(float(margin))
    if ('?' in chars or min(scores) < 0.72 or
            sum(scores) / len(scores) < 0.84 or min(margins) < 0.003):
        return None, sum(scores) / len(scores)
    return chars, sum(scores) / len(scores)


def safe_read_commitment(nt, roi):
    v, sc, txt = read_commitment(nt, roi)
    lay = commitment_layout(roi)
    boxes = (lay or {}).get('boxes') or []
    if v is not None and lay is not None and txt:
        chars = list(txt.replace(',', ''))
        if len(chars) == len(boxes):
            repaired = repair_commitment_geometry(chars, boxes)
            if repaired != chars:
                txt = commitment_text(repaired, lay)
                v = float(txt.replace(',', '.'))
        return v, sc, txt

    if v is None and lay is not None:
        chars, relaxed_sc = relaxed_commitment_chars(nt, roi, lay)
        if chars is not None and len(chars) == len(boxes):
            chars = repair_commitment_geometry(chars, boxes)
            txt = commitment_text(chars, lay)
            return float(txt.replace(',', '.')), relaxed_sc, txt

        # PokerStars renders an integer ``4`` wider than every other one-digit
        # amount in this theme.  The frozen classifier can reject it as a
        # near-tie with ``1`` when chips touch the prefix, even though the
        # amount geometry itself is complete.  Accept only the narrow invariant
        # used by the existing 1->4 repair: one integer glyph, no decimal tail,
        # a visible currency prefix, and the characteristic wide 4 box.  The
        # temporal ledger still requires this value on two consecutive frames
        # before it becomes sovereign.
        if (not lay.get('decimal') and len(boxes) == 1 and
                int(boxes[0][2]) >= 7 and int(boxes[0][3]) >= 11 and
                int(boxes[0][4]) >= 40 and commitment_prefix_present(roi)):
            return 4.0, max(float(relaxed_sc), 0.80), '4'

    if v is None and commitment_prefix_present(roi):
        return None, sc, '!VISIBLE_UNREADABLE'
    return v, sc, txt


def commitment_crop_with_tail(im, seat):
    x, y, w, h = DEFAULT_CAL['seats'][seat]['commit']
    return im[y:y+h, x:min(im.shape[1], x+w+24)]


def safe_read_commitment_with_tail(nt, im, seat):
    roi = commitment_crop(im, seat)
    v, sc, txt = safe_read_commitment(nt, roi)
    suspicious = (v is None and commitment_prefix_present(roi)) or (v == 0.0 and ',' not in (txt or ''))
    if suspicious:
        tail = commitment_crop_with_tail(im, seat)
        tv, tsc, ttxt = safe_read_commitment(nt, tail)
        if tv is not None and ',' in (ttxt or ''):
            return tv, tsc, ttxt, tail
    return v, sc, txt, roi


def fresh_commitments(im, hand, t, seat_stacks, present_now):
    resolved = {}; direct = {}; sources = {}; ambiguous = []
    street = hand['street'] if hand else 0
    active_known = bool(hand is not None and hand.get('dealtSeats'))
    for seat in SEATS:
        if active_known and seat not in hand['active']:
            resolved[seat] = 0.0; direct[seat] = None; sources[seat] = 'inactive'
            continue

        v, sc, txt, roi = safe_read_commitment_with_tail(commit_reader, im, seat)
        lay = commitment_layout(roi)
        old = hand['commitLedger'].get(seat) if hand is not None else None
        persisted = old[1] if old and old[0] == street else None

        if isinstance(txt, str) and txt.startswith('!'):
            resolved[seat] = None; direct[seat] = None; sources[seat] = 'BLOCK-visible-unreadable'; ambiguous.append(seat)
            continue

        accepted = None
        if v is not None:
            v = round2(v)
            monotonic = persisted is None or v + 0.02 >= persisted
            if monotonic:
                cand = hand['commitCandidates'].get(seat) if hand is not None else None
                same = bool(cand and cand[0] == street and abs(float(cand[1]) - float(v)) <= 0.02 and t - float(cand[3]) <= 0.35)
                n = int(cand[2]) + 1 if same else 1
                if hand is not None:
                    hand['commitCandidates'][seat] = (street, v, n, t)
                if (persisted is not None and abs(float(v) - float(persisted)) <= 0.02) or n >= 2:
                    accepted = v

        if accepted is not None:
            resolved[seat] = accepted; direct[seat] = accepted; sources[seat] = 'direct-confirmed'
            if hand is not None:
                hand['commitLedger'][seat] = (street, accepted, t)
        elif persisted is not None:
            resolved[seat] = persisted; direct[seat] = None; sources[seat] = 'persisted'
        elif lay is None:
            resolved[seat] = 0.0; direct[seat] = 0.0; sources[seat] = 'empty'
            if hand is not None:
                hand['commitLedger'][seat] = (street, 0.0, t)
        else:
            resolved[seat] = None; direct[seat] = None; sources[seat] = 'BLOCK'; ambiguous.append(seat)
    return resolved, direct, sources, ambiguous

def add_event(hand, t, seat, action, amount=None, source='state'):
    if hand is None or hand.get('terminal'):
        return
    street = hand['street']

    # A player can CHECK at most once in one betting round. If a commitment BET
    # arrives after a provisional CHECK from the same seat, the CHECK was render
    # lag and must be retracted before the history can reach Brain.
    same = [e for e in hand['events'] if e.get('seat') == seat and e.get('street') == street]
    if action == 'CHECK' and any(e.get('action') == 'CHECK' for e in same):
        reconcile_unresolved(hand, t, seat, street)
        return
    if action == 'BET':
        removed = [e for e in same if e.get('action') == 'CHECK']
        if removed:
            hand['events'] = [e for e in hand['events'] if not (e.get('seat') == seat and e.get('street') == street and e.get('action') == 'CHECK')]

    # Never duplicate a fold. Future actions after a confirmed fold are semantic
    # errors and should not be manufactured by stale UI; the active-set guard in
    # the observer prevents them from being emitted.
    if action == 'FOLD' and any(e.get('action') == 'FOLD' for e in same):
        reconcile_unresolved(hand, t, seat, street)
        return

    if hand['events']:
        e = hand['events'][-1]
        if e['seat'] == seat and e['action'] == action and abs(e['t'] - t) < .35 and e.get('amount') == amount and e.get('street') == street:
            reconcile_unresolved(hand, t, seat, street)
            return
    hand['events'].append({'t':round(t,3),'seat':seat,'action':action,'amount':amount,'source':source,'street':street})
    hand['events'].sort(key=lambda e: (e['t'], e['street']))
    hand['lastEventT'][seat] = t
    reconcile_unresolved(hand, t, seat, street)

def finalize_turn(hand, t, seat, commits, present_now):
    if hand is None or seat is None or hand.get('terminal'):
        return
    info = hand.get('turnInfo')
    if not info or info['seat'] != seat:
        return
    if hand['lastEventT'].get(seat, -1e9) >= info['startT'] - .05:
        return
    start_pc = info.get('commit')
    start_max = float(info.get('tableMax') or 0.0)
    cur_pc = commits.get(seat)
    if start_pc is not None and cur_pc is not None and round2(cur_pc) > round2(start_pc):
        if hand['street'] > 0 and start_max <= .02:
            kind = 'BET'
        else:
            kind = 'RAISE' if cur_pc > start_max + .02 else 'CALL'
        add_event(hand, t, seat, kind, round2(cur_pc), 'turn-end-commitment')
    else:
        mark_unresolved(hand, t, seat, 'turn-ended-awaiting-reconciliation', start_pc, start_max)

def new_hand(hid, t, cards):
    return {
        'id':hid, 'startT':round(t,3), 'endT':None, 'heroCards':list(cards), 'dealer':None,
        'dealtSeats':None, 'position':None, 'positionVotes':Counter(), 'street':0,
        'streetCandidate':0, 'streetCandidateN':0, 'boardTransitions':[0], 'commitLedger':{},
        'prevCommits':{s:0.0 for s in SEATS}, 'active':set(), 'prevPresent':set(),
        'events':[], 'unresolved':[], 'lastEventT':{}, 'stableTurn':None,
        'turnCandidate':None, 'turnCandidateN':0, 'turnInfo':None, 'heroTurnEpoch':0,
        'stackBaseline':{}, 'lastStacks':{s:None for s in SEATS}, 'absentVotes':{s:0 for s in SEATS},
        'commitCandidates':{}, 'closedStreetMax':{},
        'terminal':False, 'terminalT':None, 'terminalReason':None,
        'heroDecisionSeen':False, 'lastHeroDecisionT':None, 'showdownVotes':0,
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
    old_street = hand['street']
    old_vals = [v for seat,v in hand['prevCommits'].items() if v is not None and (not hand['active'] or seat in hand['active'])]
    hand['closedStreetMax'][old_street] = max(old_vals) if old_vals else 0.0
    hand['street'] = n
    hand['boardTransitions'].append(n)
    hand['commitLedger'].clear()
    hand['commitCandidates'].clear()
    hand['prevCommits'] = {s:0.0 for s in SEATS}
    hand['stackBaseline'].clear()
    hand['stableTurn'] = None; hand['turnCandidate'] = None; hand['turnCandidateN'] = 0; hand['turnInfo'] = None
    return True


def turn_observe(hand, t, raw_turn, commits, present_now):
    if hand is None or hand.get('terminal'): return
    if raw_turn is not None and hand.get('active') and raw_turn not in hand['active']:
        raw_turn = None
    if raw_turn == hand['turnCandidate']: hand['turnCandidateN'] += 1
    else: hand['turnCandidate'] = raw_turn; hand['turnCandidateN'] = 1
    if hand['turnCandidateN'] < 2 or raw_turn == hand['stableTurn']: return
    old = hand['stableTurn']
    if old is not None: finalize_turn(hand, t, old, commits, present_now)
    hand['stableTurn'] = raw_turn
    if raw_turn == 'hero': hand['heroTurnEpoch'] += 1
    vals = [v for v in commits.values() if v is not None]
    hand['turnInfo'] = None if raw_turn is None else {'seat':raw_turn,'startT':t,'commit':commits.get(raw_turn),'tableMax':max(vals) if vals else 0.0,'eventIndex':len(hand['events'])}


def action_observe(hand, t, commits, present_now):
    if hand is None or hand.get('terminal'):
        return
    prev = hand['prevCommits']
    prev_vals = [v for s,v in prev.items() if v is not None and (not hand['active'] or s in hand['active'])]
    prev_max = max(prev_vals) if prev_vals else 0.0
    eligible = set(hand['active']) if hand['active'] else set(present_now)

    changes = []
    for seat in SEATS:
        if seat not in eligible:
            continue
        pc = prev.get(seat); cc = commits.get(seat)
        if pc is None or cc is None or round2(cc) <= round2(pc):
            continue
        forced_window = (hand['street'] == 0 and t - hand['startT'] < 1.2 and hand['stableTurn'] is None)
        if not forced_window:
            changes.append((seat, float(pc), float(cc)))

    # Group equal new amounts. Poker semantics permit only one aggressor to a
    # specific new price; players reaching that same price are callers.
    groups = {}
    for seat, pc, cc in changes:
        groups.setdefault(round2(cc), []).append((seat, pc, cc))
    running_max = prev_max
    for amount in sorted(groups):
        group = groups[amount]
        if amount <= running_max + .02:
            for seat, pc, cc in group:
                add_event(hand, t, seat, 'CALL', round2(cc), 'commitment')
            continue
        preferred = hand.get('stableTurn')
        aggressor = preferred if preferred in {x[0] for x in group} else group[0][0]
        first_kind = 'BET' if hand['street'] > 0 and running_max <= .02 else 'RAISE'
        for seat, pc, cc in group:
            kind = first_kind if seat == aggressor else 'CALL'
            add_event(hand, t, seat, kind, round2(cc), 'commitment')
        running_max = max(running_max, amount)

    for seat in list(hand['active']):
        if seat in present_now:
            hand['absentVotes'][seat] = 0
            continue
        if seat == 'hero' and not hand.get('heroDecisionSeen'):
            hand['absentVotes'][seat] = 0
            continue
        # Initial deal animations can briefly remove a card-back ROI. Never infer
        # a fold until the deal has had time to settle.
        if float(t) - float(hand['startT']) < 1.5:
            hand['absentVotes'][seat] = 0
            continue
        hand['absentVotes'][seat] = hand['absentVotes'].get(seat, 0) + 1
        if hand['absentVotes'][seat] < 5:
            continue
        pc = prev.get(seat) or 0.0
        owed = max(0.0, prev_max - pc)
        info = hand.get('turnInfo')
        unresolved_turn = bool(info and info.get('seat') == seat and hand['lastEventT'].get(seat, -1e9) < info.get('startT', t) - .05)
        if owed > .02 or unresolved_turn:
            add_event(hand, t, seat, 'FOLD', source='card-disappearance')
            hand['active'].discard(seat)
            if hand.get('dealtSeats') and len(hand['active']) <= 1:
                set_terminal(hand, t, 'single-player-remains')
                break

    hand['prevCommits'] = dict(commits)
    hand['prevPresent'] = set(present_now)

def reconcile_before_hero_decision(hand, t, commits, present_now):
    if hand is None or hand.get('terminal'):
        return
    street = hand.get('street')
    for u in list(hand.get('unresolved') or []):
        if u.get('street') != street:
            continue
        seat = u.get('seat')
        if seat is None or seat == 'hero' or seat not in present_now:
            continue
        owed = u.get('owed')
        start_commit = u.get('startCommit')
        cur = commits.get(seat)
        if owed is None or round2(owed) != 0.0:
            continue
        if start_commit is not None and cur is not None and float(cur) > float(start_commit) + 0.02:
            continue
        add_event(hand, t, seat, 'CHECK', source='hero-turn-order-proof')


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
    history_complete = bool(hand is not None and not hand['unresolved'] and not ledger_semantic_errors(hand))
    snap = {
        't':round(t,3), 'hand':hand['id'] if hand else None, 'heroCards':cards,
        'board':board, 'boardPresenceCount':board_n, 'boardPresenceFlags':flags,
        'heroStack':stack, 'pot':pot, 'toCall':tc, 'rawToCall':raw_tc, 'allInCapApplied':capped,
        'commitments':{k:round2(v) for k,v in commits.items()}, 'commitmentSources':sources,
        'ambiguousCommitments':list(ambiguous), 'position':pos, 'buttonLayout':bs.layout,
        'heroButtons':list(bs.actions), 'heroTurnConfirmed':bool(bs.confirmed),
        'heroPresence':'present' if cards else 'missing', 'actionComplete':history_complete,
        'unresolvedBeforeDecision':len(hand['unresolved']) if hand else None,
        'unresolvedEvidence':[dict(u) for u in hand['unresolved']] if hand else [],
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


cap = cv2.VideoCapture(TARGET_VIDEO)
assert cap.isOpened(), TARGET_VIDEO
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

    if not table_scene_valid(im):
        if open_decision is not None:
            finalize_decision()
        continue

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
    if current is not None and visible:
        dealt_now.add('hero')
    if current is not None and visible and current['position'] is None:
        pos = hero_position_from_dealer(dealer_now, list(dealt_now))
        position_observe(current, dealer_now, [s for s in CLOCKWISE_SEATS if s in dealt_now], pos)

    if current is not None and not current.get('terminal') and showdown_visible(im, current):
        set_terminal(current, t, 'showdown-faceup-cards')

    commits, direct_commits, commit_sources, ambiguous = fresh_commitments(im, current, t, None, dealt_now)
    if current is not None and not current.get('terminal'):
        raw_turn, _ = turn_seat(im)
        action_observe(current, t, commits, dealt_now)
        resolve_pending(current, t, commits, dealt_now)
        turn_observe(current, t, raw_turn, commits, dealt_now)

    hand_transition_pending = bool(current is not None and visible and cards is not None and tuple(cards) != tuple(current['heroCards']))
    bs = hero_button_state(im)
    if bs.confirmed and not hand_transition_pending:
        if current is not None and not current.get('terminal'):
            current['heroDecisionSeen'] = True
            current['lastHeroDecisionT'] = round(t, 3)
            reconcile_before_hero_decision(current, t, commits, dealt_now)
        snap = decision_snapshot(im, t, current, commits, commit_sources, ambiguous, bs)
        key = (snap.get('hand'), snap.get('heroTurnEpoch'))
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

hand_by_id = {h['id']: h for h in hands}
for d in decisions:
    h = hand_by_id.get(d.get('hand'))
    if d.get('position') is None and h is not None and h.get('position') is not None:
        d['position'] = h['position']
        errors = [e for e in d['brainGate']['errors'] if e != 'position_missing']
        d['brainGate'] = {'ok': not errors, 'errors': errors}

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
    # A zero-price CHECK can leave no chip or card delta.  When the same hand
    # later returns to Hero (or advances street) the prior CHECK is logically
    # proven by the physical CHECK button and continued participation.  This
    # closes the action without using target labels or future card values.
    if (ev is None and d.get('buttonLayout') == 'check-bet' and
            d.get('toCall') is not None and float(d['toCall']) <= 0.001):
        later_same_hand = next((x for x in decisions[idx+1:] if x.get('hand') == d.get('hand')), None)
        if later_same_hand is not None:
            ev = {
                't':round(float(d.get('windowEndT') or d['t']) + 0.001, 3),
                'seat':'hero', 'action':'CHECK', 'amount':None,
                'source':'next-hero-turn-proof', 'street':len(d.get('board') or [])
            }
            h['events'].append(ev)
            h['events'].sort(key=lambda e: (e['t'], e['street']))
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
        'decisionIds':h['decisionIds'],'events':h['events'],'unresolved':h['unresolved'],
        'terminal':h.get('terminal'), 'terminalT':h.get('terminalT'), 'terminalReason':h.get('terminalReason'),
        'ledgerSemanticErrors':ledger_semantic_errors(h)
    }
    hdec = [d for d in decisions if d['hand'] == h['id']]
    hd['continuityOk'] = bool(h['position'] and h['heroCards'] and all(d.get('heroAction') is not None for d in hdec) and all(d['unresolvedBeforeDecision'] == 0 for d in hdec) and not ledger_semantic_errors(h) and h['boardTransitions'] == sorted(set(h['boardTransitions']), key=lambda x:STREET_ORDER[x]))
    continuity_ok += int(hd['continuityOk'])
    hand_out.append(hd)

block_reasons = Counter()
for d in decisions:
    for e in d['brainGate']['errors']: block_reasons[e] += 1

summary = {
    'scannerVersion':'ssj-pokerstars-offline-v11',
    'sourceReaderHead':'cdecb04b6230a343535fcca5129a14a5579ea44f',
    'calibrationPolicy':'sessions 1-2 frozen only; target contributes zero templates/labels/thresholds',
    'targetVideo':{'name':Path(TARGET_VIDEO).name,'width':width,'height':height,'fps':fps,'frames':frames,'durationSec':round(frames/fps,3),'sampleStepFrames':sample_step},
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
    'criticalInternalInconsistencies':len(raw_critical) + sum(len(ledger_semantic_errors(h)) for h in hands),
}

result = {'summary':summary,'decisions':decisions,'hands':hand_out,'discardedButtonWindows':discarded_windows,'criticalInternal':raw_critical}
Path(OUT).write_text(json.dumps(result, indent=2), encoding='utf-8')
print('V11_SCAN_SUMMARY=' + json.dumps(summary, separators=(',',':')))
for d in decisions:
    print('V11_DECISION=' + json.dumps({
        'i':d['i'],'t':d['t'],'hand':d['hand'],'heroCards':d['heroCards'],'board':d['board'],'stack':d['heroStack'],'pot':d['pot'],
        'toCall':d['toCall'],'position':d['position'],'layout':d['buttonLayout'],'brainOk':d['brainGate']['ok'],
        'errors':d['brainGate']['errors'],'consensus':d['windowConsensus'],'heroAction':None if d.get('heroAction') is None else d['heroAction']['action']
    }, separators=(',',':')))

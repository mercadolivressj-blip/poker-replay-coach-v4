from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

# V5 is applied after v3 + v4. It keeps the reader frozen and only changes
# temporal/state reconciliation in the audit ledger.

# Replace V4's unresolved helpers with a scene-validity gate and richer pending
# action records. The 0.35 green-table threshold is deliberately loose relative
# to the stable PokerStars table samples from sessions 1-4 (>~0.50 in normal
# table view) and rejects desktop/OBS occlusions without looking at video5 labels.
a = s.index('def reconcile_unresolved(')
b = s.index('def fresh_commitments(', a)
helpers = '''def table_scene_valid(im):
    x, y, w, h = DEFAULT_CAL['table']
    roi = im[y:y+h, x:x+w]
    if roi.size == 0:
        return False
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    green = cv2.inRange(hsv, (30, 50, 25), (95, 255, 255))
    return (float(cv2.countNonZero(green)) / float(green.size)) >= 0.35


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
    if hand is None or not hand['unresolved']:
        return
    current_street = hand['street']
    for u in list(hand['unresolved']):
        seat = u.get('seat')
        us = u.get('street')
        if seat is None or us is None:
            continue
        if seat in present_now:
            u['presentVotes'] = int(u.get('presentVotes', 0)) + 1
            u['absentVotes'] = 0
        else:
            u['absentVotes'] = int(u.get('absentVotes', 0)) + 1
            u['presentVotes'] = 0

        # Stable disappearance on a valid table is fold evidence. Five 10-Hz
        # samples avoids treating a render/animation miss as an action.
        if us == current_street and u['absentVotes'] >= 5:
            add_event(hand, t, seat, 'FOLD', source='pending-stable-disappearance')
            hand['active'].discard(seat)
            continue

        if u['presentVotes'] < 3:
            continue

        start_commit = u.get('startCommit')
        target = u.get('target')
        owed = u.get('owed')

        # Same-street monetary state can resolve the pending action exactly.
        if us == current_street:
            cur = commits.get(seat)
            if start_commit is not None and target is not None and cur is not None:
                if cur > float(start_commit) + 0.02:
                    if cur > float(target) + 0.02:
                        kind = 'RAISE' if not (current_street > 0 and float(target) <= 0.02) else 'BET'
                    else:
                        kind = 'CALL'
                    add_event(hand, t, seat, kind, round2(cur), 'pending-commitment')
                elif owed is not None and float(owed) <= 0.02:
                    add_event(hand, t, seat, 'CHECK', source='pending-presence')
            continue

        # If the player is stably present on a later street, the prior action
        # did not fold. We only synthesize a CALL when the final observed max on
        # the closed street never exceeded the target they faced; that excludes
        # an unobserved raise. Otherwise keep the BLOCK.
        closed_max = hand.get('closedStreetMax', {}).get(us)
        if owed is not None and float(owed) <= 0.02:
            add_event_for_street(hand, t, seat, 'CHECK', us, None, 'street-survival')
        elif target is not None and closed_max is not None and float(closed_max) <= float(target) + 0.02:
            add_event_for_street(hand, t, seat, 'CALL', us, round2(target), 'street-survival')


def add_event_for_street(hand, t, seat, action, street, amount=None, source='state'):
    if hand is None:
        return
    # Do not recursively call add_event: this is a backfilled action on a closed
    # street proved by later state evidence.
    et = round(float(t) - 0.001, 3)
    hand['events'].append({'t': et, 'seat': seat, 'action': action, 'amount': amount, 'source': source, 'street': street})
    hand['events'].sort(key=lambda e: (e['t'], e['street']))
    reconcile_unresolved(hand, t, seat, street)


'''
s = s[:a] + helpers + s[b:]

# Replace V4 commitment resolution. Opponent seat-stack OCR is no longer used
# as a monetary fallback. A new direct commitment must be stable for two
# consecutive 10-Hz samples before entering the ledger; otherwise we persist the
# last confirmed same-street value or BLOCK.
a = s.index('def fresh_commitments(')
b = s.index('\ndef add_event', a)
replacement = '''def fresh_commitments(im, hand, t, seat_stacks, present_now):
    resolved = {}; direct = {}; sources = {}; ambiguous = []
    street = hand['street'] if hand else 0
    active_known = bool(hand is not None and hand.get('dealtSeats'))
    for seat in SEATS:
        if active_known and seat not in hand['active']:
            resolved[seat] = 0.0; direct[seat] = None; sources[seat] = 'inactive'
            continue

        roi = commitment_crop(im, seat)
        v, sc, txt = read_commitment(commit_reader, roi)
        lay = commitment_layout(roi)
        old = hand['commitLedger'].get(seat) if hand is not None else None
        persisted = old[1] if old and old[0] == street else None

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

'''
s = s[:a] + replacement + s[b+1:]

# Turn-end never folds from a single missing-card sample. It records a pending
# action with the exact amount faced; stable disappearance/commitment evidence
# resolves it later.
a = s.index('def finalize_turn(')
b = s.index('\ndef new_hand', a)
replacement = '''def finalize_turn(hand, t, seat, commits, present_now):
    if hand is None or seat is None: return
    info = hand.get('turnInfo')
    if not info or info['seat'] != seat: return
    if hand['lastEventT'].get(seat, -1e9) >= info['startT'] - .05:
        return
    start_pc = info.get('commit')
    start_max = float(info.get('tableMax') or 0.0)
    cur_pc = commits.get(seat)
    if start_pc is not None and cur_pc is not None and cur_pc > start_pc + .02:
        if hand['street'] > 0 and start_max <= .02:
            kind = 'BET'
        else:
            kind = 'RAISE' if cur_pc > start_max + .02 else 'CALL'
        add_event(hand, t, seat, kind, round2(cur_pc), 'turn-end-commitment')
    elif start_pc is not None and start_max - start_pc <= .02 and seat in present_now:
        add_event(hand, t, seat, 'CHECK', source='turn-end')
    else:
        mark_unresolved(hand, t, seat, 'turn-ended-without-resolved-action', start_pc, start_max)

'''
s = s[:a] + replacement + s[b+1:]

# Hand state: direct commitment candidate consensus + final max per closed street.
old = """        'stackBaseline':{}, 'lastStacks':{s:None for s in SEATS}, 'absentVotes':{s:0 for s in SEATS},\n"""
new = """        'stackBaseline':{}, 'lastStacks':{s:None for s in SEATS}, 'absentVotes':{s:0 for s in SEATS},\n        'commitCandidates':{}, 'closedStreetMax':{},\n"""
assert old in s
s = s.replace(old, new)

# Preserve the final confirmed table max before resetting a street. This lets a
# later-street survivor prove a prior CALL only when an unseen raise is ruled out.
old = """    hand['street'] = n\n    hand['boardTransitions'].append(n)\n    hand['commitLedger'].clear()\n    hand['prevCommits'] = {s:0.0 for s in SEATS}\n    hand['stackBaseline'].clear()\n    hand['stableTurn'] = None; hand['turnCandidate'] = None; hand['turnCandidateN'] = 0; hand['turnInfo'] = None\n"""
new = """    old_street = hand['street']\n    old_vals = [v for seat,v in hand['prevCommits'].items() if v is not None and (not hand['active'] or seat in hand['active'])]\n    hand['closedStreetMax'][old_street] = max(old_vals) if old_vals else 0.0\n    hand['street'] = n\n    hand['boardTransitions'].append(n)\n    hand['commitLedger'].clear()\n    hand['commitCandidates'].clear()\n    hand['prevCommits'] = {s:0.0 for s in SEATS}\n    hand['stackBaseline'].clear()\n    hand['stableTurn'] = None; hand['turnCandidate'] = None; hand['turnCandidateN'] = 0; hand['turnInfo'] = None\n"""
assert old in s
s = s.replace(old, new)

# Replace V4 action observer. Folds require stable disappearance and cannot be
# emitted after the same turn was already resolved. This also prevents cleanup
# after CHECK from being rewritten as FOLD.
a = s.index('def action_observe(')
b = s.index('\ndef decision_snapshot', a)
replacement = '''def action_observe(hand, t, commits, present_now):
    if hand is None: return
    prev = hand['prevCommits']
    prev_vals = [v for s,v in prev.items() if v is not None and (not hand['active'] or s in hand['active'])]
    prev_max = max(prev_vals) if prev_vals else 0.0
    eligible = set(hand['active']) if hand['active'] else set(present_now)

    for seat in SEATS:
        if seat not in eligible: continue
        pc = prev.get(seat); cc = commits.get(seat)
        if pc is None or cc is None: continue
        if cc > pc + .02:
            forced_window = (hand['street'] == 0 and t - hand['startT'] < 1.2 and hand['stableTurn'] is None)
            if not forced_window:
                if hand['street'] > 0 and prev_max <= .02:
                    kind = 'BET'
                else:
                    kind = 'RAISE' if cc > prev_max + .02 else 'CALL'
                add_event(hand, t, seat, kind, round2(cc), 'commitment')

    for seat in list(hand['active']):
        if seat in present_now:
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

    hand['prevCommits'] = dict(commits)
    hand['prevPresent'] = set(present_now)

'''
s = s[:a] + replacement + s[b+1:]

# Ignore non-table/occluded frames entirely. They may advance wall-clock time,
# but they must not mutate hand state or become evidence of folds/zero commits.
old = """    t = fi / fps\n\n    hp = hero_presence(im)\n"""
new = """    t = fi / fps\n\n    if not table_scene_valid(im):\n        if open_decision is not None:\n            finalize_decision()\n        continue\n\n    hp = hero_presence(im)\n"""
assert old in s
s = s.replace(old, new)

# Independent Hero-card presence is stronger than the generic dealt-seat crop.
# Keep Hero active whenever both fixed Hero card slots are visibly occupied.
old = """    dealt_now = set(dealt_seats(im)) if current is not None else set()\n    if current is not None and visible and current['position'] is None:\n"""
new = """    dealt_now = set(dealt_seats(im)) if current is not None else set()\n    if current is not None and visible:\n        dealt_now.add('hero')\n    if current is not None and visible and current['position'] is None:\n"""
assert old in s
s = s.replace(old, new)

# Stop sampling opponent stack OCR altogether. Commitments are now direct +
# persisted only. Resolve pending actions after commitment/fold observation and
# before turn transitions / Hero snapshots.
old = """    seat_stacks = read_seat_stacks(im)\n    if current is not None:\n        for _seat, _sv in seat_stacks.items():\n            if _sv is not None: current['lastStacks'][_seat] = _sv\n    commits, direct_commits, commit_sources, ambiguous = fresh_commitments(im, current, t, seat_stacks, dealt_now)\n    if current is not None:\n        raw_turn, _ = turn_seat(im)\n        action_observe(current, t, commits, dealt_now)\n        turn_observe(current, t, raw_turn, commits, dealt_now)\n"""
new = """    commits, direct_commits, commit_sources, ambiguous = fresh_commitments(im, current, t, None, dealt_now)\n    if current is not None:\n        raw_turn, _ = turn_seat(im)\n        action_observe(current, t, commits, dealt_now)\n        resolve_pending(current, t, commits, dealt_now)\n        turn_observe(current, t, raw_turn, commits, dealt_now)\n"""
assert old in s
s = s.replace(old, new)

p.write_text(s)

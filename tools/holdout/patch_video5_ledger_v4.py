from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

# Add opponent/hero stack sampling using the already-frozen numeric stack bank.
needle = """def money_snapshot(im):\n    sv, ss, _ = stack_reader.read(crop(im, DEFAULT_CAL['heroStackValue']), 'stack')\n    pv, ps, _ = pot_reader.read(crop(im, DEFAULT_CAL['potValue']), 'pot')\n    return round2(sv), round2(pv), float(ss), float(ps)\n\n\n"""
insert = """def money_snapshot(im):\n    sv, ss, _ = stack_reader.read(crop(im, DEFAULT_CAL['heroStackValue']), 'stack')\n    pv, ps, _ = pot_reader.read(crop(im, DEFAULT_CAL['potValue']), 'pot')\n    return round2(sv), round2(pv), float(ss), float(ps)\n\n\ndef read_seat_stacks(im):\n    out = {}\n    for seat, row in DEFAULT_CAL['seats'].items():\n        v, sc, _ = stack_reader.read(crop(im, row['stack']), 'stack')\n        out[seat] = round2(v) if v is not None else None\n    return out\n\n\ndef reconcile_unresolved(hand, t, seat, street, max_delay=2.5):\n    if hand is None: return\n    kept = []\n    for u in hand['unresolved']:\n        same = u.get('seat') == seat and u.get('street') == street\n        delay = float(t) - float(u.get('t', t))\n        if same and -0.05 <= delay <= max_delay:\n            continue\n        kept.append(u)\n    hand['unresolved'] = kept\n\n\ndef mark_unresolved(hand, t, seat, reason):\n    if hand is None or seat is None: return\n    street = hand['street']\n    # A turn can flicker during an animation/modal. Keep only one unresolved\n    # candidate per seat/street until later state evidence reconciles it.\n    if any(u.get('seat') == seat and u.get('street') == street for u in hand['unresolved']):\n        return\n    hand['unresolved'].append({'t':round(t,3),'seat':seat,'reason':reason,'street':street})\n\n\n"""
assert needle in s
s = s.replace(needle, insert)

# Replace commitment resolution. Same-street commitments never fall back to zero
# merely because the label is temporarily hidden. Fixed-ROI reads are sanity
# checked against monotonicity and a stack-derived commitment baseline. Stack
# delta is used only as a fallback, matching the production architecture.
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
        cur_stack = seat_stacks.get(seat)

        base = hand['stackBaseline'].get(seat) if hand is not None else None
        stack_delta = None
        if base and base[0] == street and cur_stack is not None:
            base_stack, base_commit = base[1], base[2]
            d = base_stack - cur_stack
            if d >= -0.03 and d <= base_stack + base_commit + 0.03:
                stack_delta = round2(max(0.0, base_commit + d))

        sane_direct = None
        if v is not None:
            v = round2(v)
            monotonic = persisted is None or v + 0.02 >= persisted
            within_stack = True
            if base and base[0] == street:
                max_total = base[1] + base[2] + 0.03
                within_stack = v <= max_total
            # When stack delta is available, a large disagreement means text or
            # animation leaked into the commitment ROI; do not let it poison the ledger.
            agrees_stack = stack_delta is None or abs(v - stack_delta) <= max(0.08, 0.25 * max(0.01, v, stack_delta))
            if monotonic and within_stack and agrees_stack:
                sane_direct = v

        if sane_direct is not None:
            resolved[seat] = sane_direct; direct[seat] = sane_direct; sources[seat] = 'direct'
            if hand is not None:
                hand['commitLedger'][seat] = (street, sane_direct, t)
                if seat not in hand['stackBaseline'] and cur_stack is not None:
                    hand['stackBaseline'][seat] = (street, cur_stack, sane_direct)
        elif stack_delta is not None and (persisted is None or stack_delta + 0.02 >= persisted):
            val = max(stack_delta, persisted or 0.0)
            resolved[seat] = round2(val); direct[seat] = None; sources[seat] = 'stack-delta'
            if hand is not None: hand['commitLedger'][seat] = (street, resolved[seat], t)
        elif persisted is not None:
            resolved[seat] = persisted; direct[seat] = None; sources[seat] = 'persisted'
        elif lay is None:
            resolved[seat] = 0.0; direct[seat] = 0.0; sources[seat] = 'empty'
            if hand is not None:
                hand['commitLedger'][seat] = (street, 0.0, t)
                if seat not in hand['stackBaseline'] and cur_stack is not None:
                    hand['stackBaseline'][seat] = (street, cur_stack, 0.0)
        else:
            resolved[seat] = None; direct[seat] = None; sources[seat] = 'BLOCK'; ambiguous.append(seat)
    return resolved, direct, sources, ambiguous

'''
s = s[:a] + replacement + s[b+1:]

# Any trustworthy event can reconcile a provisional turn-end miss for the same
# seat/street if it appears shortly afterwards.
old = """    hand['events'].append({'t':round(t,3),'seat':seat,'action':action,'amount':amount,'source':source,'street':hand['street']})\n    hand['lastEventT'][seat] = t\n"""
new = """    hand['events'].append({'t':round(t,3),'seat':seat,'action':action,'amount':amount,'source':source,'street':hand['street']})\n    hand['lastEventT'][seat] = t\n    reconcile_unresolved(hand, t, seat, hand['street'])\n"""
assert old in s
s = s.replace(old, new)

# finalize_turn came from the v3 patch. Keep its strict semantics, but unresolved
# is now provisional/reconcilable rather than append-only forever.
old = """    else:\n        hand['unresolved'].append({'t':round(t,3),'seat':seat,'reason':'turn-ended-without-resolved-action','street':hand['street']})\n\n"""
new = """    else:\n        mark_unresolved(hand, t, seat, 'turn-ended-without-resolved-action')\n\n"""
assert old in s
s = s.replace(old, new, 1)

# Add stack baselines + card-absence hysteresis to each hand.
old = """        'events':[], 'unresolved':[], 'lastEventT':{}, 'stableTurn':None,\n        'turnCandidate':None, 'turnCandidateN':0, 'turnInfo':None, 'heroTurnEpoch':0,\n"""
new = """        'events':[], 'unresolved':[], 'lastEventT':{}, 'stableTurn':None,\n        'turnCandidate':None, 'turnCandidateN':0, 'turnInfo':None, 'heroTurnEpoch':0,\n        'stackBaseline':{}, 'lastStacks':{s:None for s in SEATS}, 'absentVotes':{s:0 for s in SEATS},\n"""
assert old in s
s = s.replace(old, new)

# A new street resets commitment and stack-delta baselines, but unresolved from
# the previous street stays visible to the strict gate unless it was reconciled.
old = """    hand['commitLedger'].clear()\n    hand['prevCommits'] = {s:0.0 for s in SEATS}\n    hand['stableTurn'] = None; hand['turnCandidate'] = None; hand['turnCandidateN'] = 0; hand['turnInfo'] = None\n"""
new = """    hand['commitLedger'].clear()\n    hand['prevCommits'] = {s:0.0 for s in SEATS}\n    hand['stackBaseline'].clear()\n    hand['stableTurn'] = None; hand['turnCandidate'] = None; hand['turnCandidateN'] = 0; hand['turnInfo'] = None\n"""
assert old in s
s = s.replace(old, new)

# Replace action observer: only eligible active seats may produce commitment
# actions, and fold inference requires stable card disappearance rather than one
# noisy sample. This prevents cleanup/animation commitments after a player folded.
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

    # Stable card disappearance: two consecutive sampled misses (0.2 s at the
    # current 10 Hz scan) before a fold can be emitted.
    for seat in list(hand['active']):
        if seat in present_now:
            hand['absentVotes'][seat] = 0
            continue
        hand['absentVotes'][seat] = hand['absentVotes'].get(seat, 0) + 1
        if hand['absentVotes'][seat] < 2: continue
        pc = prev.get(seat) or 0.0
        owed = max(0.0, prev_max - pc)
        recent_turn = hand['stableTurn'] == seat or (hand.get('turnInfo') and hand['turnInfo']['seat'] == seat and t - hand['turnInfo']['startT'] < 1.5)
        if owed > .02 or recent_turn:
            add_event(hand, t, seat, 'FOLD', source='card-disappearance')
            hand['active'].discard(seat)

    hand['prevCommits'] = dict(commits)
    hand['prevPresent'] = set(present_now)

'''
s = s[:a] + replacement + s[b+1:]

# Main loop: sample all seat stacks first, then resolve commitments with stack
# delta and active-seat context.
old = """    commits, direct_commits, commit_sources, ambiguous = fresh_commitments(im, current, t)\n    if current is not None:\n"""
new = """    seat_stacks = read_seat_stacks(im)\n    if current is not None:\n        for _seat, _sv in seat_stacks.items():\n            if _sv is not None: current['lastStacks'][_seat] = _sv\n    commits, direct_commits, commit_sources, ambiguous = fresh_commitments(im, current, t, seat_stacks, dealt_now)\n    if current is not None:\n"""
assert old in s
s = s.replace(old, new)

p.write_text(s)

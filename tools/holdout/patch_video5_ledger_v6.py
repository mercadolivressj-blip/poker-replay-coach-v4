from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

# V6 is a semantic/temporal ledger fix over V5. No reader/template thresholds
# are changed. The goal is to stop turning render lag, dealing animations and
# showdown card reveals into valid poker actions.

# Helpers: showdown/terminal detection and a semantic validator used by the
# strict Brain gate. Opponent face-up cards reuse the already-proven white-card
# presence rule rather than introducing a new OCR reader.
needle = "def reconcile_unresolved(hand, t, seat, street):\n"
idx = s.index(needle)
helpers = '''def showdown_visible(im, hand):
    if hand is None or hand.get('street') != 5:
        return False
    active = set(hand.get('active') or [])
    for seat in active:
        if seat == 'hero':
            continue
        row = DEFAULT_CAL['seats'][seat]
        # hero=True means white face-up-card geometry instead of red backs.
        if seat_dealt_in(crop(im, row['cards']), hero=True):
            return True
    return False


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


'''
s = s[:idx] + helpers + s[idx:]

# add_event becomes transaction-safe. A delayed BET invalidates a provisional
# CHECK by the same player on the same street. Multiple CHECKs for one seat in a
# betting round are never valid and are deduped. No actions may be appended once
# a hand is terminal.
a = s.index('def add_event(')
b = s.index('\ndef finalize_turn', a)
replacement = '''def add_event(hand, t, seat, action, amount=None, source='state'):
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

'''
s = s[:a] + replacement + s[b+1:]

# A turn ending with no commitment change is provisional even when the player
# appears to owe zero. PokerStars often paints the commitment one or two frames
# after the progress bar leaves. resolve_pending, not finalize_turn, decides
# CHECK/FOLD/CALL after a grace window or stronger later evidence.
a = s.index('def finalize_turn(')
b = s.index('\ndef new_hand', a)
replacement = '''def finalize_turn(hand, t, seat, commits, present_now):
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
    if start_pc is not None and cur_pc is not None and cur_pc > start_pc + .02:
        if hand['street'] > 0 and start_max <= .02:
            kind = 'BET'
        else:
            kind = 'RAISE' if cur_pc > start_max + .02 else 'CALL'
        add_event(hand, t, seat, kind, round2(cur_pc), 'turn-end-commitment')
    else:
        mark_unresolved(hand, t, seat, 'turn-ended-awaiting-reconciliation', start_pc, start_max)

'''
s = s[:a] + replacement + s[b+1:]

# Replace pending reconciliation. Eight stable 10-Hz presence samples create a
# render-lag grace period before CHECK. Preflop phantom CHECKs after a voluntary
# raise are discarded: there is no legal preflop CHECK after a raise. Stable
# disappearance remains fold evidence, but never during the dealing grace.
a = s.index('def resolve_pending(')
b = s.index('\ndef add_event_for_street', a)
replacement = '''def resolve_pending(hand, t, commits, present_now):
    if hand is None or hand.get('terminal') or not hand['unresolved']:
        return
    current_street = hand['street']
    for u in list(hand['unresolved']):
        seat = u.get('seat'); us = u.get('street')
        if seat is None or us is None:
            continue

        # If a normal fold/action already removed this player, that event is the
        # reconciliation. Do not let a stale turn candidate create another fold.
        if seat not in hand['active']:
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

        if u['presentVotes'] < 8:
            continue

        start_commit = u.get('startCommit')
        target = u.get('target')
        owed = u.get('owed')
        active_vals = [v for s,v in commits.items() if v is not None and s in hand['active']]
        now_max = max(active_vals) if active_vals else 0.0

        if us == current_street:
            cur = commits.get(seat)
            if start_commit is not None and target is not None and cur is not None and cur > float(start_commit) + 0.02:
                if cur > float(target) + 0.02:
                    kind = 'RAISE' if not (current_street > 0 and float(target) <= 0.02) else 'BET'
                else:
                    kind = 'CALL'
                add_event(hand, t, seat, kind, round2(cur), 'pending-commitment')
                continue

            if owed is not None and float(owed) <= 0.02:
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
        if owed is not None and float(owed) <= 0.02:
            if us == 0 and any(e.get('street') == 0 and e.get('action') == 'RAISE' and e.get('t', 0) <= u.get('t', t) + .05 for e in hand['events']):
                reconcile_unresolved(hand, t, seat, us)
            else:
                add_event_for_street(hand, t, seat, 'CHECK', us, None, 'street-survival')
        elif target is not None and closed_max is not None and float(closed_max) <= float(target) + 0.02:
            add_event_for_street(hand, t, seat, 'CALL', us, round2(target), 'street-survival')

'''
s = s[:a] + replacement + s[b+1:]

# add_event_for_street gets the same dedupe/semantic protections for backfilled
# closed-street actions.
a = s.index('def add_event_for_street(')
b = s.index('\ndef fresh_commitments', a)
replacement = '''def add_event_for_street(hand, t, seat, action, street, amount=None, source='state'):
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

'''
s = s[:a] + replacement + s[b+1:]

# Hand state gains a terminal state. Once only one player remains or showdown is
# visually proven, stale labels/stack text cannot create more betting actions.
old = """        'commitCandidates':{}, 'closedStreetMax':{},\n"""
new = """        'commitCandidates':{}, 'closedStreetMax':{},\n        'terminal':False, 'terminalT':None, 'terminalReason':None,\n"""
assert old in s
s = s.replace(old, new)

# Ignore inactive turn-band candidates. They are a common source of duplicate
# folds/unresolved actions after a player has already left the hand.
a = s.index('def turn_observe(')
b = s.index('\ndef action_observe', a)
old_func = s[a:b]
old_head = "def turn_observe(hand, t, raw_turn, commits, present_now):\n    if hand is None: return\n"
new_head = "def turn_observe(hand, t, raw_turn, commits, present_now):\n    if hand is None or hand.get('terminal'): return\n    if raw_turn is not None and hand.get('active') and raw_turn not in hand['active']:\n        raw_turn = None\n"
assert old_head in old_func
old_func = old_func.replace(old_head, new_head, 1)
s = s[:a] + old_func + s[b:]

# Replace action observer with batched monetary updates. When several players hit
# the same new commitment in one 10-Hz sample, at most one can be the raiser;
# the previous stable turn gets priority and the rest are CALLs. Fold inference
# is disabled during the first 1.5 s of a hand and terminates the hand at one
# remaining active player.
a = s.index('def action_observe(')
b = s.index('\ndef decision_snapshot', a)
replacement = '''def action_observe(hand, t, commits, present_now):
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
        if pc is None or cc is None or cc <= pc + .02:
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

'''
s = s[:a] + replacement + s[b+1:]

# The strict Brain gate now requires both zero unresolved actions and zero poker
# semantic contradictions in the ledger.
old = "history_complete = bool(hand is not None and not hand['unresolved'])"
new = "history_complete = bool(hand is not None and not hand['unresolved'] and not ledger_semantic_errors(hand))"
assert old in s
s = s.replace(old, new, 1)

# Mark showdown terminal before commitments/action observers can mistake revealed
# cards, player stacks or winner labels for new betting evidence.
old = """    if current is not None and visible and current['position'] is None:\n        pos = hero_position_from_dealer(dealer_now, list(dealt_now))\n        position_observe(current, dealer_now, [s for s in CLOCKWISE_SEATS if s in dealt_now], pos)\n\n    commits, direct_commits, commit_sources, ambiguous = fresh_commitments(im, current, t, None, dealt_now)\n"""
new = """    if current is not None and visible and current['position'] is None:\n        pos = hero_position_from_dealer(dealer_now, list(dealt_now))\n        position_observe(current, dealer_now, [s for s in CLOCKWISE_SEATS if s in dealt_now], pos)\n\n    if current is not None and not current.get('terminal') and showdown_visible(im, current):\n        set_terminal(current, t, 'showdown-faceup-cards')\n\n    commits, direct_commits, commit_sources, ambiguous = fresh_commitments(im, current, t, None, dealt_now)\n"""
assert old in s
s = s.replace(old, new)

# Skip turn/action mutation after terminal while still allowing the outer hand
# detector to observe the next hand.
old = """    if current is not None:\n        raw_turn, _ = turn_seat(im)\n        action_observe(current, t, commits, dealt_now)\n        resolve_pending(current, t, commits, dealt_now)\n        turn_observe(current, t, raw_turn, commits, dealt_now)\n"""
new = """    if current is not None and not current.get('terminal'):\n        raw_turn, _ = turn_seat(im)\n        action_observe(current, t, commits, dealt_now)\n        resolve_pending(current, t, commits, dealt_now)\n        turn_observe(current, t, raw_turn, commits, dealt_now)\n"""
assert old in s
s = s.replace(old, new)

# Export semantic errors/terminal reason per hand and make continuity strict.
old = """        'decisionIds':h['decisionIds'],'events':h['events'],'unresolved':h['unresolved']\n    }\n"""
new = """        'decisionIds':h['decisionIds'],'events':h['events'],'unresolved':h['unresolved'],\n        'terminal':h.get('terminal'), 'terminalT':h.get('terminalT'), 'terminalReason':h.get('terminalReason'),\n        'ledgerSemanticErrors':ledger_semantic_errors(h)\n    }\n"""
assert old in s
s = s.replace(old, new)

old = """    hd['continuityOk'] = bool(h['position'] and h['heroCards'] and all(d.get('heroAction') is not None for d in hdec) and all(d['unresolvedBeforeDecision'] == 0 for d in hdec) and h['boardTransitions'] == sorted(set(h['boardTransitions']), key=lambda x:STREET_ORDER[x]))\n"""
new = """    hd['continuityOk'] = bool(h['position'] and h['heroCards'] and all(d.get('heroAction') is not None for d in hdec) and all(d['unresolvedBeforeDecision'] == 0 for d in hdec) and not ledger_semantic_errors(h) and h['boardTransitions'] == sorted(set(h['boardTransitions']), key=lambda x:STREET_ORDER[x]))\n"""
assert old in s
s = s.replace(old, new)

# Critical count must include final-history semantic contradictions, including
# cleanup/showdown errors that happened after the last Hero decision.
old = """    'criticalInternalInconsistencies':len(raw_critical),\n"""
new = """    'criticalInternalInconsistencies':len(raw_critical) + sum(len(ledger_semantic_errors(h)) for h in hands),\n"""
assert old in s
s = s.replace(old, new)

p.write_text(s)

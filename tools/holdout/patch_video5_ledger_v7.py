from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

# V7 is applied after V6. It fixes the three remaining post-blind ledger gaps
# without changing any visual reader, ROI, template or threshold:
#   1) Hero cannot be folded during deal/render animation before a real Hero turn.
#   2) A confirmed physical Hero decision proves a zero-owed prior actor checked.
#   3) Showdown terminal detection cannot fire before the river betting round has
#      actually produced legal action and the turn indicator has gone idle.

# Hand state remembers whether a real physical Hero decision has ever been seen
# and debounces showdown evidence independently from card-back presence.
old = """        'terminal':False, 'terminalT':None, 'terminalReason':None,\n"""
new = """        'terminal':False, 'terminalT':None, 'terminalReason':None,\n        'heroDecisionSeen':False, 'lastHeroDecisionT':None, 'showdownVotes':0,\n"""
assert old in s
s = s.replace(old, new, 1)

# V6's face-up-card signal was allowed to terminal a hand as soon as the river
# appeared. A card-back/avatar render could therefore look white enough to stop
# the ledger before the final river action. Require legal river action first,
# require the physical turn indicator to be idle, and require five consecutive
# 10-Hz face-up samples. When Hero is still active, Hero must already have acted
# on the river; if Hero folded earlier, any river action is sufficient.
a = s.index('def showdown_visible(')
b = s.index('\n\ndef set_terminal', a)
replacement = '''def showdown_visible(im, hand):
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
'''
s = s[:a] + replacement + s[b:]

# Hero card disappearance before the first physical Hero decision is never a
# legal Hero fold. This specifically protects long PokerStars deal animations
# while preserving fast-fold recovery after a real decision window has appeared.
old = """    for seat in list(hand['active']):\n        if seat in present_now:\n            hand['absentVotes'][seat] = 0\n            continue\n        # Initial deal animations can briefly remove a card-back ROI. Never infer\n"""
new = """    for seat in list(hand['active']):\n        if seat in present_now:\n            hand['absentVotes'][seat] = 0\n            continue\n        if seat == 'hero' and not hand.get('heroDecisionSeen'):\n            hand['absentVotes'][seat] = 0\n            continue\n        # Initial deal animations can briefly remove a card-back ROI. Never infer\n"""
assert old in s
s = s.replace(old, new, 1)

# A confirmed physical Hero button window means action has reached Hero. If a
# previous same-street actor is still present, faced zero, and never increased
# their commitment, CHECK is the only legal action. Resolve that pending action
# immediately so the Brain snapshot does not BLOCK for harmless render lag.
needle = 'def decision_snapshot('
idx = s.index(needle)
helper = '''def reconcile_before_hero_decision(hand, t, commits, present_now):
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
        if owed is None or float(owed) > 0.02:
            continue
        if start_commit is not None and cur is not None and float(cur) > float(start_commit) + 0.02:
            continue
        add_event(hand, t, seat, 'CHECK', source='hero-turn-order-proof')


'''
s = s[:idx] + helper + s[idx:]

# Mark a real Hero decision from the authoritative physical buttons before the
# snapshot is taken, then reconcile any zero-owed prior action proven by turn
# order. action_observe runs earlier in the sample, so the flag is available for
# subsequent disappearance samples and cannot manufacture an action retroactively.
old = """    bs = hero_button_state(im)\n    if bs.confirmed:\n        snap = decision_snapshot(im, t, current, commits, commit_sources, ambiguous, bs)\n"""
new = """    bs = hero_button_state(im)\n    if bs.confirmed:\n        if current is not None and not current.get('terminal'):\n            current['heroDecisionSeen'] = True\n            current['lastHeroDecisionT'] = round(t, 3)\n            reconcile_before_hero_decision(current, t, commits, dealt_now)\n        snap = decision_snapshot(im, t, current, commits, commit_sources, ambiguous, bs)\n"""
assert old in s
s = s.replace(old, new, 1)

p.write_text(s)

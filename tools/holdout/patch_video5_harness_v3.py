from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

# One physical button window stays one decision even if Hero turn is
# confirmed a few frames after the buttons first appear.
old = """        if open_decision is not None:\n            oldkey = (open_decision['best'].get('hand'), open_decision['best'].get('heroTurnEpoch'))\n            if key != oldkey and snap.get('heroTurnEpoch') not in (None,0): finalize_decision()\n"""
assert old in s
s = s.replace(old, '')

# Do not attach samples from newly dealt cards to the previous hand while the
# new-card candidate is stabilizing.
old2 = """    bs = hero_button_state(im)\n    if bs.confirmed:\n"""
new2 = """    hand_transition_pending = bool(current is not None and visible and cards is not None and tuple(cards) != tuple(current['heroCards']))\n    bs = hero_button_state(im)\n    if bs.confirmed and not hand_transition_pending:\n"""
assert old2 in s
s = s.replace(old2, new2)

# Reconcile commitment evidence before turn-end. The previous audit harness
# could emit CHECK and then CALL/RAISE on the same frame because turn-end was
# finalized before the changed commitment was observed.
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
    if seat not in present_now:
        add_event(hand, t, seat, 'FOLD', source='turn-end')
        hand['active'].discard(seat)
    elif start_pc is not None and cur_pc is not None and cur_pc > start_pc + .02:
        if hand['street'] > 0 and start_max <= .02:
            kind = 'BET'
        else:
            kind = 'RAISE' if cur_pc > start_max + .02 else 'CALL'
        add_event(hand, t, seat, kind, round2(cur_pc), 'turn-end-commitment')
    elif start_pc is not None and start_max - start_pc <= .02:
        add_event(hand, t, seat, 'CHECK', source='turn-end')
    else:
        hand['unresolved'].append({'t':round(t,3),'seat':seat,'reason':'turn-ended-without-resolved-action','street':hand['street']})

'''
s = s[:a] + replacement + s[b+1:]

old3 = """    hand['turnInfo'] = None if raw_turn is None else {'seat':raw_turn,'startT':t,'commit':commits.get(raw_turn),'eventIndex':len(hand['events'])}\n"""
new3 = """    vals = [v for v in commits.values() if v is not None]\n    hand['turnInfo'] = None if raw_turn is None else {'seat':raw_turn,'startT':t,'commit':commits.get(raw_turn),'tableMax':max(vals) if vals else 0.0,'eventIndex':len(hand['events'])}\n"""
assert old3 in s
s = s.replace(old3, new3)

old4 = """        turn_observe(current, t, raw_turn, commits, dealt_now)\n        action_observe(current, t, commits, dealt_now)\n"""
new4 = """        action_observe(current, t, commits, dealt_now)\n        turn_observe(current, t, raw_turn, commits, dealt_now)\n"""
assert old4 in s
s = s.replace(old4, new4)

p.write_text(s)

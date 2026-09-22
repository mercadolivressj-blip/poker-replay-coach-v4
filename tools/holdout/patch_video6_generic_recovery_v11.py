"""V11: reconcile pending actions while the initial active-seat set is unknown.

The active set is populated only after position/dealer consensus.  Treating an
empty, not-yet-known set as proof that every villain was inactive caused valid
card-presence and closed-street evidence to be ignored.  Keep the inactive-seat
guard only once ``dealtSeats`` has actually been established.
"""

from pathlib import Path
import sys


p = Path(sys.argv[1])
s = p.read_text()

old = """        if seat not in hand['active']:
            if any(e.get('seat') == seat and e.get('street') == us and e.get('action') == 'FOLD' for e in hand['events']):
                reconcile_unresolved(hand, t, seat, us)
            continue
"""
new = """        if hand.get('dealtSeats') and seat not in hand['active']:
            if any(e.get('seat') == seat and e.get('street') == us and e.get('action') == 'FOLD' for e in hand['events']):
                reconcile_unresolved(hand, t, seat, us)
            continue
"""

assert old in s
s = s.replace(old, new, 1)
p.write_text(s)

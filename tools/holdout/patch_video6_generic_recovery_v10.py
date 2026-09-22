from pathlib import Path
import sys


p = Path(sys.argv[1])
s = p.read_text()

# Generic follow-up to V9.  PokerStars shifts the text to the right when a
# commitment has a taller chip stack.  The legacy fixed ROI can then clip the
# cents and turn e.g. a decimal amount into the integer zero.  Retry only such
# suspicious/incomplete rows with a small right extension; normal reads remain
# byte-for-byte unchanged.
needle = 'def fresh_commitments('
idx = s.index(needle)
helper = r'''def commitment_crop_with_tail(im, seat):
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


'''
s = s[:idx] + helper + s[idx:]

old_read = '''        roi = commitment_crop(im, seat)\n        v, sc, txt = safe_read_commitment(commit_reader, roi)\n        lay = commitment_layout(roi)'''
new_read = '''        v, sc, txt, roi = safe_read_commitment_with_tail(commit_reader, im, seat)\n        lay = commitment_layout(roi)'''
assert old_read in s
s = s.replace(old_read, new_read, 1)

# Once a new street is physically on screen, an unresolved player who remains
# active has already survived the closed street.  Resolve a call immediately
# when the final closed-street maximum never exceeded the recorded target.
# This proof does not depend on delayed card-presence votes and still refuses to
# guess when an unseen raise may have occurred.
old_wait = '''        if u['presentVotes'] < 8:\n            continue\n\n        start_commit = u.get('startCommit')'''
new_wait = '''        if us != current_street:\n            target = u.get('target')\n            closed_max = hand.get('closedStreetMax', {}).get(us)\n            if closed_max is None:\n                observed = [e.get('amount') for e in hand.get('events', [])\n                            if e.get('street') == us and e.get('amount') is not None]\n                closed_max = max(observed) if observed else None\n            if target is not None and closed_max is not None and float(closed_max) <= float(target) + 0.02:\n                add_event_for_street(hand, t, seat, 'CALL', us, round2(target), 'street-survival')\n            continue\n\n        if u['presentVotes'] < 8:\n            continue\n\n        start_commit = u.get('startCommit')'''
assert old_wait in s
s = s.replace(old_wait, new_wait, 1)

p.write_text(s)

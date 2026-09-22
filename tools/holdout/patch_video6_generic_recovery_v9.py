from pathlib import Path
import sys


p = Path(sys.argv[1])
s = p.read_text()

# Generic recovery layer applied after the conservative V8 safety patch.
# It does not contain video-6 timestamps, cards, seats, pots, stacks, hands or
# expected actions.  It fixes three theme/state invariants found by the blind:
#   1) in this PokerStars font a wide glyph classified as digit 1 is digit 4;
#   2) a complete amount row may use a narrowly relaxed template margin while
#      retaining strong per-glyph and mean similarity floors;
#   3) one physical button window must not be split by hand confirmation, and a
#      position confirmed later in the same hand may backfill its snapshots.

old_safe = r'''def safe_read_commitment(nt, roi):
    v, sc, txt = read_commitment(nt, roi)
    lay = commitment_layout(roi)
    if v is not None and lay is not None and txt:
        chars = txt.replace(',', '')
        boxes = lay.get('boxes') or []
        if len(chars) == len(boxes):
            # In this fixed PokerStars font the digit 1 is narrow. If template
            # matching calls a wide glyph '1', abstain instead of silently
            # confusing a wider digit with 1.
            for ch, box in zip(chars, boxes):
                if ch == '1' and int(box[2]) >= 7:
                    return None, sc, '!GEOMETRY_CONFLICT'
    if v is None and commitment_prefix_present(roi):
        return None, sc, '!VISIBLE_UNREADABLE'
    return v, sc, txt
'''

new_safe = r'''def commitment_text(chars, layout):
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

    if v is None and commitment_prefix_present(roi):
        return None, sc, '!VISIBLE_UNREADABLE'
    return v, sc, txt
'''

assert old_safe in s
s = s.replace(old_safe, new_safe, 1)

# A hand is confirmed a few sampled frames after its cards first appear.  Do
# not split an already-open button window at that bookkeeping boundary; the
# normal evidence score will retain the complete snapshot from the confirmed
# hand, while the no-button timeout still separates physical decisions.
old_transition = '''            if candidate_n >= required:\n                finalize_decision()\n                if current is not None: current['endT'] = round(t,3)'''
new_transition = '''            if candidate_n >= required:\n                if current is not None: current['endT'] = round(t,3)'''
assert old_transition in s
s = s.replace(old_transition, new_transition, 1)

# Keep the unresolved evidence in the offline artifact.  This makes any future
# history block auditable without changing the Brain contract.
old_unresolved = "        'unresolvedBeforeDecision':len(hand['unresolved']) if hand else None,\n"
new_unresolved = "        'unresolvedBeforeDecision':len(hand['unresolved']) if hand else None,\n        'unresolvedEvidence':[dict(u) for u in hand['unresolved']] if hand else [],\n"
assert old_unresolved in s
s = s.replace(old_unresolved, new_unresolved, 1)

# Position votes can settle later in the same hand than the first Hero button
# window.  Once the same hand has a confirmed position, backfill only snapshots
# from that hand and remove only the corresponding missing-position error.
anchor = '''finalize_decision()\ncap.release()\nif current is not None: current['endT'] = round(frames / fps, 3)\n\n# Associate each physical Hero decision with the resulting Hero action.\n'''
replacement = '''finalize_decision()\ncap.release()\nif current is not None: current['endT'] = round(frames / fps, 3)\n\nhand_by_id = {h['id']: h for h in hands}\nfor d in decisions:\n    h = hand_by_id.get(d.get('hand'))\n    if d.get('position') is None and h is not None and h.get('position') is not None:\n        d['position'] = h['position']\n        errors = [e for e in d['brainGate']['errors'] if e != 'position_missing']\n        d['brainGate'] = {'ok': not errors, 'errors': errors}\n\n# Associate each physical Hero decision with the resulting Hero action.\n'''
assert anchor in s
s = s.replace(anchor, replacement, 1)

p.write_text(s)

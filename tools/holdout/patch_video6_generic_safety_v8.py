from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

# Generic post-blind safety fix. No video6 timestamp, label, card, pot, stack,
# seat or hand value is embedded here. The fixes are theme/ledger invariants:
#   1) a visually present but undecodable commitment is BLOCK, not zero/stale;
#   2) a wide glyph cannot silently decode as PokerStars digit '1';
#   3) cent-denominated commitments use exact rounded-cent comparisons;
#   4) CHECK requires exactly zero owed, never the former <= $0.02 tolerance.

needle = 'def fresh_commitments('
idx = s.index(needle)
helpers = r'''def commitment_prefix_present(roi):
    """Independent presence test for a PokerStars US$ commitment row.

    This intentionally does not decode the amount. It only proves that a
    currency row is visible, so a failed numeric decode cannot be rewritten as
    an empty commitment.
    """
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    sat, val = hsv[:, :, 1], hsv[:, :, 2]
    bw = (((sat < 155) & (val > 80)).astype('uint8')) * 255
    glyphs = []
    for c in _contours(bw):
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


def safe_read_commitment(nt, roi):
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
s = s[:idx] + helpers + s[idx:]

old = """        v, sc, txt = read_commitment(commit_reader, roi)\n        lay = commitment_layout(roi)\n        old = hand['commitLedger'].get(seat) if hand is not None else None\n        persisted = old[1] if old and old[0] == street else None\n\n        accepted = None\n"""
new = """        v, sc, txt = safe_read_commitment(commit_reader, roi)\n        lay = commitment_layout(roi)\n        old = hand['commitLedger'].get(seat) if hand is not None else None\n        persisted = old[1] if old and old[0] == street else None\n\n        if isinstance(txt, str) and txt.startswith('!'):\n            resolved[seat] = None; direct[seat] = None; sources[seat] = 'BLOCK-visible-unreadable'; ambiguous.append(seat)\n            continue\n\n        accepted = None\n"""
assert old in s
s = s.replace(old, new, 1)

# Stable commitment values are rounded to cents. A one-cent change is a real
# poker action; the old two-cent deadband both lost legitimate calls and allowed
# pending-presence to manufacture CHECKs while money was owed.
s = s.replace('cur_pc > start_pc + .02', 'round2(cur_pc) > round2(start_pc)')
s = s.replace('cc <= pc + .02', 'round2(cc) <= round2(pc)')
s = s.replace('cc > running_max + .02', 'round2(cc) > round2(running_max)')
s = s.replace('cur > float(start_commit) + 0.02', 'round2(cur) > round2(start_commit)')

# CHECK is legal only when the rounded amount owed is exactly zero.
s = s.replace('float(owed) <= 0.02', 'round2(owed) == 0.0')
s = s.replace('if owed is None or float(owed) > 0.02:', 'if owed is None or round2(owed) != 0.0:')

p.write_text(s)

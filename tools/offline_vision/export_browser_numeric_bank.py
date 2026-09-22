#!/usr/bin/env python3
"""Export the frozen PokerStars numeric glyphs for the browser.

The output contains only normalized binary digit masks. Runtime recordings and
holdout labels never contribute to this bank. Stack and pot use the exact V11
calibration split: video 1 plus the two documented video-2 calibration frames.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "offline_vision"))

from pokerstars_offline import DEFAULT_CAL, NumericTemplates, crop  # noqa: E402
from pokerstars_commitments import add_commitment_labeled, commitment_crop  # noqa: E402

COMMITMENTS = [
    (80.0, "top", .50), (80.0, "hero", .25),
    (128.5, "top", .25), (128.5, "rt", .50),
    (212.5, "rb", .25), (212.5, "hero", .50),
    (247.0, "lb", .50), (247.0, "hero", .25),
    (269.0, "rt", .67), (373.0, "rt", 6.81),
    (396.0, "rt", .25), (396.0, "rb", .50),
    (662.6, "lt", .25), (721.2, "lt", 3.75),
    (752.8, "lt", 9.50), (769.0, "lt", 41.75),
    (877.6, "lt", .50),
]

POT1 = [1.25,1.19,3.64,2.00,1.25,.75,1.19,4.99,5.94,.75,2.74,1.90,2.66,3.33,.75,2.14,4.04,11.35,17.12,.75,2.14,2.14,2.64,3.00,.75,1.94,.75,.75,1.45,.75,1.75,3.32,4.32,6.72,.75,5.50,7.84,13.84,15.44,25.44,33.49,75.24,1.90,22.30,1.75,3.56,5.34]


def collect(video: str, timestamps):
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        raise SystemExit(f"cannot open calibration video: {video}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    wanted = {int(round(float(t) * fps)): float(t) for t in timestamps}
    frames = {}
    frame_index = 0
    last = max(wanted)
    while frame_index <= last and cap.grab():
        if frame_index in wanted:
            ok, image = cap.retrieve()
            if not ok:
                raise SystemExit(f"cannot decode frame {frame_index}")
            frames[wanted[frame_index]] = image.copy()
        frame_index += 1
    cap.release()
    if len(frames) != len(set(map(float, timestamps))):
        raise SystemExit("not all calibration frames were decoded")
    return frames


def sparse(mask):
    flat = (mask.reshape(-1) > 0)
    return [int(i) for i, value in enumerate(flat) if value]


def main():
    if len(sys.argv) not in (3, 4):
        raise SystemExit("usage: export_browser_numeric_bank.py VIDEO1 [VIDEO2] OUTPUT_JSON")
    video1, output = sys.argv[1], sys.argv[-1]
    video2 = sys.argv[2] if len(sys.argv) == 4 else None
    root = ROOT
    gt1 = json.loads((root / "standalone-lab/calibration/session-2026-09-20-ground-truth-v2.json").read_text())
    wanted1 = {float(w["best_t"]) for w in gt1["heroDecisionWindows"]}
    wanted1.update(t for t, _, _ in COMMITMENTS)
    frames = collect(video1, wanted1)
    reader = NumericTemplates(); stack = NumericTemplates(); pot = NumericTemplates()
    for timestamp, seat, value in COMMITMENTS:
        roi = commitment_crop(frames[timestamp], seat)
        if not add_commitment_labeled(reader, roi, value):
            raise SystemExit(f"could not label {timestamp} {seat} {value}")
    stack_count = pot_count = 0
    for window, pot_value in zip(gt1["heroDecisionWindows"], POT1):
        image = frames[float(window["best_t"])]
        stack_count += int(stack.add_labeled(crop(image, DEFAULT_CAL["heroStackValue"]), window["heroStack"], "stack"))
        pot_count += int(pot.add_labeled(crop(image, DEFAULT_CAL["potValue"]), pot_value, "pot"))
    if video2:
        gt2 = json.loads((root / "standalone-lab/calibration/session-2026-09-21-ground-truth-v1.json").read_text())
        window = gt2["decisions"][11]
        cap = cv2.VideoCapture(video2); cap.set(cv2.CAP_PROP_POS_MSEC, float(window["best_t"]) * 1000)
        ok, image = cap.read(); cap.release()
        if not ok or not pot.add_labeled(crop(image, DEFAULT_CAL["potValue"]), window["pot"], "pot"):
            raise SystemExit("could not label video-2 pot calibration")
        pot_count += 1
    if not reader.ready() or not stack.ready() or not pot.ready():
        raise SystemExit("digit bank is incomplete")
    digits = lambda bank: {digit: [sparse(mask) for mask in masks] for digit, masks in bank.bank.items()}
    payload = {
        "version": "pokerstars-numeric-digits-v11-v2",
        "calibration": "video-1 plus documented video-2 pot calibration",
        "width": 24,
        "height": 32,
        "digits": digits(reader),
        "profiles": {"commitment": {"digits": digits(reader)}, "stack": {"digits": digits(stack)}, "pot": {"digits": digits(pot)}},
        "samples": {"commitment": len(COMMITMENTS), "stack": stack_count, "pot": pot_count},
    }
    Path(output).write_text(json.dumps(payload, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Export the frozen video-1 PokerStars commitment glyphs for the browser.

The output contains only normalized binary digit masks.  Runtime recordings and
holdout labels never contribute to this bank.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "offline_vision"))

from pokerstars_offline import NumericTemplates  # noqa: E402
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


def collect(video: str):
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        raise SystemExit(f"cannot open calibration video: {video}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    wanted = {int(round(t * fps)): t for t, _, _ in COMMITMENTS}
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
    if len(frames) != len({t for t, _, _ in COMMITMENTS}):
        raise SystemExit("not all calibration frames were decoded")
    return frames


def sparse(mask):
    flat = (mask.reshape(-1) > 0)
    return [int(i) for i, value in enumerate(flat) if value]


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: export_browser_numeric_bank.py VIDEO1 OUTPUT_JSON")
    frames = collect(sys.argv[1])
    reader = NumericTemplates()
    for timestamp, seat, value in COMMITMENTS:
        roi = commitment_crop(frames[timestamp], seat)
        if not add_commitment_labeled(reader, roi, value):
            raise SystemExit(f"could not label {timestamp} {seat} {value}")
    if not reader.ready():
        raise SystemExit("digit bank is incomplete")
    payload = {
        "version": "pokerstars-commitment-digits-video1-v1",
        "calibration": "session-2026-09-20 only",
        "width": 24,
        "height": 32,
        "digits": {digit: [sparse(mask) for mask in masks] for digit, masks in reader.bank.items()},
    }
    Path(sys.argv[2]).write_text(json.dumps(payload, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()

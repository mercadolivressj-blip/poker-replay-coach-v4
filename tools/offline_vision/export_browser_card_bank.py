#!/usr/bin/env python3
"""Export frozen V11 PokerStars hero/board card glyphs for the browser."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "offline_vision"))

import card_templates as cm  # noqa: E402
from card_templates import CardTemplates  # noqa: E402
from pokerstars_offline import DEFAULT_CAL, crop  # noqa: E402

BOARD1 = {
    3:['5c','Tc','2h','4d'], 9:['6d','3c','As','9s','2s'], 14:['As','6c','Js'],
    19:['7h','9s','As','Th','6h'], 23:['As','7d','9s','4d','Ah'], 26:['4d','2s','6c'],
    29:['8s','9c','9s'], 34:['Jc','7c','Kh','8s','5c'], 42:['Tc','Th','As','3c','Td'],
    47:['Td','6s','Ts','6c'],
}


def collect(video, timestamps):
    cap = cv2.VideoCapture(video)
    if not cap.isOpened(): raise SystemExit(f"cannot open {video}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    wanted = {int(round(float(t) * fps)): float(t) for t in timestamps}
    frames = {}; index = 0; last = max(wanted)
    while index <= last and cap.grab():
        if index in wanted:
            ok, image = cap.retrieve()
            if not ok: raise SystemExit(f"cannot decode frame {index}")
            frames[wanted[index]] = image.copy()
        index += 1
    cap.release()
    if len(frames) != len(wanted): raise SystemExit("missing calibration frames")
    return frames


def sparse(mask):
    return [int(i) for i, value in enumerate(mask.reshape(-1) > 0) if value]


def export(reader):
    return {
        "ranks": {label: [sparse(mask) for mask in masks] for label, masks in reader.ranks.items()},
        "suits": {label: [sparse(mask) for mask in masks] for label, masks in reader.suits.items()},
        "thresholds": {"rankMin": reader.rank_min, "suitMin": reader.suit_min, "rankMargin": reader.rank_margin, "suitMargin": reader.suit_margin},
    }


def main():
    if len(sys.argv) != 3: raise SystemExit("usage: export_browser_card_bank.py VIDEO1 OUTPUT_JSON")
    gt = json.loads((ROOT / "standalone-lab/calibration/session-2026-09-20-ground-truth-v2.json").read_text())
    times = {float(w["best_t"]) for w in gt["heroDecisionWindows"]}
    frames = collect(sys.argv[1], times)
    hero = CardTemplates(rank_min=.50, suit_min=.46, rank_margin=.008, suit_margin=.018)
    board = CardTemplates(rank_min=.48, suit_min=.44, rank_margin=.008, suit_margin=.006)
    for window in gt["heroDecisionWindows"]:
        image = frames[float(window["best_t"])]
        cards = gt["hands"][window["hand"] - 1]["heroCards"]
        for rect, card in zip(DEFAULT_CAL["heroCards"], cards): hero.add(crop(image, rect), card)
    for decision, cards in BOARD1.items():
        window = gt["heroDecisionWindows"][decision - 1]
        image = frames[float(window["best_t"])]
        for rect, card in zip(DEFAULT_CAL["board"], cards): board.add(crop(image, rect), card, include_suit=(card != "As"))
    for window in gt["heroDecisionWindows"]:
        cards = gt["hands"][window["hand"] - 1]["heroCards"]
        if any(card[0] == "Q" for card in cards):
            image = frames[float(window["best_t"])]
            for rect, card in zip(DEFAULT_CAL["heroCards"], cards):
                if card[0] == "Q": board.ranks.setdefault("Q", []).append(cm._glyph(crop(image, rect), "rank"))
            break
    payload = {"version":"pokerstars-card-glyphs-v11-v1","width":24,"height":32,"hero":export(hero),"board":export(board)}
    Path(sys.argv[2]).write_text(json.dumps(payload, separators=(",", ":")) + "\n")


if __name__ == "__main__": main()

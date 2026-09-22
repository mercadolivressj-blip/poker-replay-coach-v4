#!/usr/bin/env python3
"""Verify the frozen six-video V11 scanner outputs.

Usage:
  python3 tools/holdout/certify_v11_suite.py video1.json ... video6.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "standalone-lab/calibration/six-video-v11-certification.json"
COMPLETE_FIELDS = (
    "buttonsConfirmed",
    "heroCardsComplete",
    "boardComplete",
    "heroStackComplete",
    "potComplete",
    "toCallComplete",
    "positionComplete",
    "historyComplete",
    "brainValidDecisions",
    "heroActionAfterDecision",
)


def fail(message: str) -> None:
    raise SystemExit(f"V11 CERTIFICATION FAILED: {message}")


def main(paths: list[str]) -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    expected = manifest["videos"]
    if len(paths) != len(expected):
        fail(f"expected {len(expected)} result files, received {len(paths)}")

    totals = {"hands": 0, "heroDecisions": 0}
    rows = []
    for spec, raw_path in zip(expected, paths):
        result = json.loads(Path(raw_path).read_text(encoding="utf-8"))
        summary = result.get("summary") or {}
        prefix = spec["id"]
        if summary.get("scannerVersion") != "ssj-pokerstars-offline-v11":
            fail(f"{prefix}: wrong scanner version")
        for key in ("frames", "durationSec"):
            actual = (summary.get("targetVideo") or {}).get(key)
            if actual != spec[key]:
                fail(f"{prefix}: {key} expected {spec[key]!r}, got {actual!r}")
        if summary.get("handsDetected") != spec["hands"]:
            fail(f"{prefix}: hand count mismatch")
        decisions = spec["heroDecisions"]
        if summary.get("heroDecisionsDetected") != decisions:
            fail(f"{prefix}: decision count mismatch")
        for field in COMPLETE_FIELDS:
            if summary.get(field) != decisions:
                fail(f"{prefix}: {field} is {summary.get(field)!r}/{decisions}")
        if summary.get("handContinuity") != f"{spec['hands']}/{spec['hands']}":
            fail(f"{prefix}: continuity is {summary.get('handContinuity')!r}")
        if summary.get("blockReasons") != {}:
            fail(f"{prefix}: blocked decisions {summary.get('blockReasons')!r}")
        if summary.get("criticalInternalInconsistencies") != 0:
            fail(f"{prefix}: critical internal inconsistency")
        if summary.get("discardedButtonWindows") != 0:
            fail(f"{prefix}: discarded physical decision window")
        if summary.get("unstableDecisionWindows") != spec["unstableDecisionWindows"]:
            fail(f"{prefix}: unexpected window-consensus regression")

        result_decisions = result.get("decisions") or []
        if len(result_decisions) != decisions:
            fail(f"{prefix}: serialized decision count mismatch")
        if any(not (d.get("brainGate") or {}).get("ok") for d in result_decisions):
            fail(f"{prefix}: serialized blocked decision")
        if any(d.get("heroAction") is None for d in result_decisions):
            fail(f"{prefix}: missing resulting Hero action")
        hands = result.get("hands") or []
        if len(hands) != spec["hands"] or any(not h.get("continuityOk") for h in hands):
            fail(f"{prefix}: serialized hand continuity mismatch")
        # A recording may end while an opponent is acting after the final Hero
        # decision.  That trailing observation is outside the certified
        # decision window.  Every decision must still have entered Brain with
        # zero unresolved actions, and no hand may contain a semantic error.
        if any((d.get("unresolvedBeforeDecision") or 0) != 0 for d in result_decisions):
            fail(f"{prefix}: unresolved action before a Hero decision")
        if any(h.get("ledgerSemanticErrors") for h in hands):
            fail(f"{prefix}: semantically invalid ledger")

        totals["hands"] += spec["hands"]
        totals["heroDecisions"] += decisions
        rows.append({
            "id": prefix,
            "role": spec["role"],
            "hands": spec["hands"],
            "heroDecisions": decisions,
            "status": "PASS",
        })

    if totals["hands"] != manifest["totals"]["hands"]:
        fail("suite hand total mismatch")
    if totals["heroDecisions"] != manifest["totals"]["heroDecisions"]:
        fail("suite decision total mismatch")

    print(json.dumps({
        "version": manifest["version"],
        "status": "PASS",
        "hands": totals["hands"],
        "heroDecisions": totals["heroDecisions"],
        "videos": rows,
    }, separators=(",", ":")))


if __name__ == "__main__":
    main(sys.argv[1:])

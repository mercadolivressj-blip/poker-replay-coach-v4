# Policy V4 — Recovery Ledger

Status: **artifact exact not recovered yet**.

This ledger exists to prevent accidental reconstruction, approximation or false parity claims.

## Frozen identity

- Policy: `postflop-policy-v4`
- Expected SHA-256: `bb98bc8a27ec4bb634ff380ec1315c3bc4cc7605a81a65ce0ece2848a4e27181`
- Frozen source project: `Hero Card Rescue`
- Frozen source project ID: `a4352431-0461-41cd-bebc-1e1e617a190c`
- Last frozen-project commit recorded by historical handoff: `3efde306fbb1dda38584cb8ffee0c2245b6231f4`
- Intended vendored artifact path: `src/strategy-v1/postflop-policy-model.json`

## Additional historical evidence

A prior 2026-09-15 certification conversation records:

- the frozen model artifact was approximately **4.5 MB**;
- training input names included `postflop_500k_train_set` and `/tmp/feat_train.csv`;
- evaluation references included `/tmp/pb_post.csv` and `feat_test.csv`;
- reports were named `audit/policy/postflop-v4-policy.md` and `audit/policy/decision-layer-v4.md`;
- serialized tree thresholds containing `+inf` were repaired to finite JSON value `1e308`.

These clues were searched in Library/history but still do not reveal a recoverable artifact path. Library JSON inventory contains no ~4.5 MB candidate.

## Exact source modules named by the historical migration plan

- `src/lib/postflop.ts`
- `src/lib/postflop-decision.ts`
- `src/lib/postflop-policy-decision.ts`
- `src/lib/postflop-policy.ts`
- `src/lib/postflop-policy-features.ts`
- `src/lib/postflop-policy-model.json`
- `src/lib/hand-strength.ts`
- `src/lib/hand-eval.ts`
- `src/lib/board-texture.ts`
- `src/lib/poker-math.ts`
- `src/lib/poker-state.ts`
- `src/lib/raise-mapping.ts`

## Recovery locations checked

- Current/default GitHub branch.
- `vision-v1-brain-integration`.
- `hybrid-lovable-vision-v1`.
- `feature/dynamic-coach-brain-v1`.
- `feature/gemini-standalone-final`.
- `feature/state-transaction-r14`.
- `feature/pokerstars-suit-scanner-r9`.
- Other surviving replay/coach feature branches.
- Git commit object lookup for recorded frozen-project SHA; it is not present in this GitHub repository.
- PR #11 migration discussion and PR #12 discussion; no attached artifact was found.
- Current GitHub Actions artifacts; none contain the frozen model.
- Library exact-name/content searches for the model and companion Policy files.
- Library generated archives:
  - `poker-strategy-engine-v0.1.zip`
  - `poker-strategy-engine-v0.2.zip`
  - `poker-strategy-engine-v0.6.zip`
  - `poker-strategy-engine-v0.7.zip`
  - `poker-replay-engine-v0.8.zip`
  - `poker-replay-standalone-v1.zip`
  - `poker-replay-standalone-v1.2.zip`
  - `poker-replay-coach-v4-standalone.zip`
- Recursive checksum scan of the materialized archives; no file matched the frozen SHA.
- Historical Vercel standalone/probe deployments; available deployments do not preserve the missing source model.
- Connected Google Drive searches for `postflop-policy-model`, `postflop-policy`, Policy V4, PokerBench, the frozen SHA, Hero Card Rescue and historical standalone/export names; no relevant artifact was found.
- Real diagnostic `replay-diagnostic-2026-09-15T21-12-17-350Z`; strategy records do not preserve Policy V4 probabilities/features/outputs and therefore cannot serve as frozen Policy V4 parity fixtures.
- Library searches for `blind10k` / `Integrated10k`; only aggregate certification numbers survived, not per-spot outputs.

Historical handoff mentions local-only directories such as `poker-replay-engine-v0.9` and standalone `v1.9/v2.x`, but no persisted Library export of those directories has been found.

## Hard rule

Do not rebuild Policy V4 from its reported training hyperparameters or metrics. Those facts are insufficient to reproduce an exact Gradient Boosting model.

The policy remains unavailable until the exact artifact is recovered and its SHA-256 matches.

After recovery, parity work must still separately verify:

1. feature extraction;
2. model inference;
3. probability mapping;
4. OOD behavior;
5. legal action mask;
6. mixed-strategy threshold;
7. Decision Layer V4 fallback semantics;
8. frozen regression outputs.

Only after all gates pass may `policyComplete` be changed to `true`.

# Cash Pro Lab V1 — Offline Classroom

Status: experimental, isolated from the protected Cash baseline.

## Mission

Build an offline study/audit system where the Cash brain is treated as a **student**, not as an authority. A decision is evaluated only when the system can prove that the spot state is sufficiently complete and trustworthy.

This lab is for **replay, simulation and post-game study only**. It must not be connected to real-time play, click automation, process/memory reading, hidden overlays or anti-cheat bypasses.

## Non-negotiable rule

> No proof of understanding = no decision evaluation.

The lab must never silently fill critical state with guesses.

## Pipeline

`Decision Node -> Understanding Proof -> Student -> Domain-Verified Oracles -> Consensus -> EV Audit -> Lesson -> Champion vs Challenger Gate`

### 1. Decision Node

Canonical BB-denominated state containing at minimum:

- Hero cards
- board/street
- Hero position
- effective stack
- Hero stack
- pot
- to-call
- active players
- legal actions
- complete action history
- rake profile
- field-level evidence/provenance

Every critical field carries a source and confidence. The initial trusted source classes are:

- hand history
- exported telemetry
- verified replay reconstruction
- manually verified fixture
- solver fixture

### 2. Understanding Proof

`proveDecisionNode` is a hard gate. It rejects, among other things:

- incomplete/duplicate cards
- board/street mismatch
- missing position
- missing or inconsistent stack/pot/to-call
- impossible active-player count
- illegal/inconsistent action set
- invalid action history
- missing rake profile
- missing or low-confidence evidence for any critical field
- assumptions in high-impact decisions

High-impact nodes include river calls, large stack fractions, large pot fractions and nodes exposing an all-in legal action.

### 3. Student

The student receives a frozen canonical node. Its output is rejected before teacher comparison if the chosen action is not legal.

The stable production brain is not modified by this module.

### 4. Teachers / Oracles

An oracle is eligible only if:

- its domain is explicitly verified for the node;
- its confidence clears the configured threshold;
- its recommended action is legal;
- it provides EV coverage for at least two legal alternatives.

For high-impact decisions, V1 requires at least **two independent verified oracles**.

A solver result from a mismatched stack/rake/domain must be marked `domainVerified: false` and is rejected from consensus.

### 5. EV Auditor

The primary learning metric is **EV loss in BB**, not raw action accuracy.

`EV loss = consensus best EV - student action EV`

Severity bands in V1:

- < 0.02 BB: negligible
- < 0.10 BB: small
- < 0.50 BB: material
- < 2.00 BB: major
- >= 2.00 BB: catastrophic

This makes one expensive stack-off error more important than many tiny action mismatches.

### 6. Champion vs Challenger

A challenger is evaluated only on paired nodes also scored for the champion.

Hard blockers include:

- any illegal action
- any terminal-state violation
- any decision made without proof
- catastrophic-error budget exceeded
- average EV regression
- high-impact EV regression
- insufficient paired sample

The gate can only produce `eligibleForHumanReview: true`.

**Automatic promotion is permanently disabled in V1 (`autoPromote: false`).**

## What V1 intentionally does not do yet

- It does not train or mutate strategy weights.
- It does not call an external solver automatically.
- It does not assume PokerBench/TexasSolver domain compatibility.
- It does not promote a challenger into the protected brain.
- It does not evaluate live real-money decisions.

## Next implementation steps

1. Build adapters from exported telemetry/hand history into `cash-pro-lab-node-v1`.
2. Build an adapter for the frozen Cash student brain.
3. Build domain descriptors for solver/PokerBench/TexasSolver sources.
4. Add persistent lesson datasets grouped by spot family.
5. Add leak reports ranked by accumulated EV loss.
6. Add challenger certification over large paired holdouts.

The long-term target is not to make the brain more confident. It is to make it **measurably harder to be wrong**, especially where mistakes cost the most BB.

# Policy V4 migration truth

Frozen source project: Hero Card Rescue `a4352431-0461-41cd-bebc-1e1e617a190c`
Frozen source commit used for behavior-preserving migration: `3efde306fbb1dda38584cb8ffee0c2245b6231f4`

## Final runtime semantics

The final frozen source does **not** use 45% support as a runtime fallback gate.

Historical V4 commits through `ffd4b26283c672f51edee4bf3c428c8a9b2471a2` contained
`MIN_CONF = 0.45`. Commit `331c92d98cbec28a76fb66c8a2d1c91874ce2941`
explicitly removed that gate and added
`postflop-policy-gate-v2-4-6.test.js`, whose low-support regression requires
`engine === "POLICY V4"` whenever the spot is in-distribution and has a legal policy action.

Therefore the migration parity target is:

- exact frozen model artifact;
- exact 74-feature ordering and missing-value semantics;
- legal-action mask on primary and mixed secondary actions;
- mixed strategy when top-two allowed actions are < 10 percentage points apart;
- fallback only for out-of-distribution / insufficient nuclear state / no legal policy action;
- low support changes confidence but does not silently replace the trained policy with the heuristic.

The older 45% threshold remains historical audit context only. It must not be reintroduced during
the behavior-preserving port.

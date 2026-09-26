# Cash Pro Lab — High-Rake Action EV Extractor

Offline post-solve inspector for the pinned `ucsandman/postflop` engine.

It does **not** solve a spot and does **not** modify the saved strategy. For one existing decision node it:

1. rebuilds the exact game from the saved solution config;
2. reconstructs opponent reach from the root using the saved average strategy and exact chance weights;
3. forces each legal action separately;
4. evaluates that child subtree with `engine::br::subtree_values(..., maximize=false)` while every later decision follows the saved average strategy;
5. divides each counterfactual value by exact opponent-compatible reach mass;
6. proves that the saved mixed strategy weighted over the forced-action EVs reconstructs the node's ordinary combo EV within a strict tolerance.

Output EVs are action-major and in the solver's zero-sum net-chip convention. Undefined zero-compatible-mass combos are serialized as `null`, never as zero.

The tool refuses locked nodes because forcing a different action there would be outside the solved constrained game.

A successful extraction is evidence for **per-action alternative EV at that solved node**. It is still not, by itself, a certified Cash Pro Lab study: exact job provenance, solution validation, teacher-independence requirements and the classroom EV audit remain separate gates.

The engine dependency is pinned by Git commit in `Cargo.toml`; do not float it to a branch or tag.

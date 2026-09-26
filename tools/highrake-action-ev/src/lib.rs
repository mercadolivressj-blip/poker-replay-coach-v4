use std::collections::HashMap;
use std::io::Read;

use engine::br::{self, StrategyProfile};
use engine::game::{Game, NodeInfo};
use engine::nlhe::NlheGame;
use engine::solution::{ActionLabelData, NodeStrategy, Solution};
use engine::tree::{NodeKind, NO_CHILD};
use serde::Serialize;

#[derive(Clone, Copy)]
enum Edge {
    Action(usize),
    Chance(usize),
}

struct FileProfile<'a> {
    nodes: &'a [NodeStrategy],
    by_node: &'a HashMap<u32, usize>,
}

impl StrategyProfile for FileProfile<'_> {
    fn strategy_into(&self, node: u32, out: &mut [f32]) {
        let &idx = self
            .by_node
            .get(&node)
            .expect("validated solution must contain every decision node");
        out.copy_from_slice(&self.nodes[idx].strategy);
    }
}

#[derive(Debug, Serialize)]
pub struct IdentityProof {
    pub compared_combos: usize,
    pub max_abs_diff: f32,
    pub tolerance: f32,
    pub passed: bool,
}

#[derive(Debug, Serialize)]
pub struct ActionEvNode {
    pub version: &'static str,
    pub node: u32,
    pub player: u8,
    pub combo_count: usize,
    pub combo_indices: Vec<u32>,
    pub actions: Vec<ActionLabelData>,
    pub strategy: Vec<f32>,
    /// Action-major. `action_evs[a * combo_count + i]` is the forced-action EV for combo i.
    /// `None` means opponent-compatible reach mass is zero, so the conditional EV is undefined.
    pub action_evs: Vec<Option<f32>>,
    /// EV when the acting player follows the stored mixed strategy at this node.
    pub combo_evs: Vec<Option<f32>>,
    pub identity: IdentityProof,
    pub unit: &'static str,
    pub convention: &'static str,
    pub certified_study: bool,
}

pub struct ActionEvExtractor {
    solution: Solution,
    game: NlheGame,
    by_node: HashMap<u32, usize>,
    parents: Vec<Option<(u32, Edge)>>,
}

impl ActionEvExtractor {
    pub fn from_reader<R: Read>(reader: R) -> Result<Self, String> {
        let solution = Solution::from_reader(reader)?;
        Self::new(solution)
    }

    pub fn new(solution: Solution) -> Result<Self, String> {
        let game = NlheGame::new(&solution.config)?;
        if solution.node_count as usize != game.tree().len() {
            return Err(format!(
                "solution node_count {} != rebuilt tree {}",
                solution.node_count,
                game.tree().len()
            ));
        }
        let mut by_node = HashMap::new();
        for (i, ns) in solution.nodes.iter().enumerate() {
            if by_node.insert(ns.node, i).is_some() {
                return Err(format!("duplicate decision node {}", ns.node));
            }
        }
        for node in 0..game.tree().len() as u32 {
            let NodeKind::Decision { player, actions } = &game.tree().node(node).kind else {
                continue;
            };
            let &idx = by_node
                .get(&node)
                .ok_or_else(|| format!("solution has no strategy for decision node {node}"))?;
            let ns = &solution.nodes[idx];
            if ns.player != *player {
                return Err(format!("node {node}: stored player {} != tree player {player}", ns.player));
            }
            let combos = game.live_combos(node, *player).len();
            if ns.combo_count as usize != combos {
                return Err(format!(
                    "node {node}: stored combo_count {} != rebuilt combo_count {combos}",
                    ns.combo_count
                ));
            }
            if ns.actions.len() != actions.len() || ns.strategy.len() != actions.len() * combos {
                return Err(format!("node {node}: action/strategy shape mismatch"));
            }
        }

        let mut parents = vec![None; game.tree().len()];
        for node in 0..game.tree().len() as u32 {
            match &game.tree().node(node).kind {
                NodeKind::Decision { actions, .. } => {
                    for (a, action) in actions.iter().enumerate() {
                        parents[action.child as usize] = Some((node, Edge::Action(a)));
                    }
                }
                NodeKind::Chance { child_for_card, .. } => {
                    let mut k = 0usize;
                    for &child in child_for_card.iter() {
                        if child != NO_CHILD {
                            parents[child as usize] = Some((node, Edge::Chance(k)));
                            k += 1;
                        }
                    }
                }
                NodeKind::Terminal(_) => {}
            }
        }

        Ok(Self { solution, game, by_node, parents })
    }

    fn profile(&self) -> FileProfile<'_> {
        FileProfile { nodes: &self.solution.nodes, by_node: &self.by_node }
    }

    fn path_to(&self, node: u32) -> Result<Vec<(u32, Edge)>, String> {
        if node as usize >= self.parents.len() {
            return Err(format!("node {node} out of range"));
        }
        let mut path = Vec::new();
        let mut cur = node;
        while let Some((parent, edge)) = self.parents[cur as usize] {
            path.push((parent, edge));
            cur = parent;
        }
        if cur != self.game.root() {
            return Err(format!("node {node} is not reachable from root"));
        }
        path.reverse();
        Ok(path)
    }

    fn reach(&self, node: u32, player: u8, with_chance_weight: bool) -> Result<Vec<f32>, String> {
        let mut cur = self.game.root_weights(player).to_vec();
        for (parent, edge) in self.path_to(node)? {
            match edge {
                Edge::Action(action) => {
                    let NodeKind::Decision { player: mover, .. } = &self.game.tree().node(parent).kind else {
                        return Err(format!("parent {parent} is not a decision node"));
                    };
                    if *mover != player {
                        continue;
                    }
                    let &idx = self
                        .by_node
                        .get(&parent)
                        .ok_or_else(|| format!("missing strategy for parent node {parent}"))?;
                    let strategy = &self.solution.nodes[idx].strategy;
                    let width = cur.len();
                    let base = action * width;
                    if base + width > strategy.len() {
                        return Err(format!("node {parent}: strategy width mismatch while reconstructing reach"));
                    }
                    for (i, weight) in cur.iter_mut().enumerate() {
                        *weight *= strategy[base + i];
                    }
                }
                Edge::Chance(outcome) => {
                    let chance = self.game.chance_outcome(parent, outcome);
                    let map = chance.parent_of_child[player as usize];
                    let deal_weight = if with_chance_weight { chance.weight } else { 1.0 };
                    cur = map
                        .iter()
                        .map(|&p| cur[p as usize] * deal_weight)
                        .collect();
                }
            }
        }
        Ok(cur)
    }

    fn combo_evs(&self, node: u32, player: u8) -> Result<Vec<Option<f32>>, String> {
        let opp_reach = self.reach(node, 1 - player, true)?;
        let mut values = vec![0.0f32; self.game.combo_count(node, player)];
        br::subtree_values(
            &self.game,
            node,
            player,
            &self.profile(),
            &opp_reach,
            false,
            &mut values,
        );
        let mass = self.game.compatible_mass(node, player, &opp_reach);
        Ok(values
            .into_iter()
            .zip(mass)
            .map(|(v, m)| if m > 0.0 { Some(v / m) } else { None })
            .collect())
    }

    pub fn action_combo_evs(&self, node: u32, tolerance: f32) -> Result<ActionEvNode, String> {
        if !tolerance.is_finite() || tolerance <= 0.0 {
            return Err("tolerance must be finite and positive".into());
        }
        let NodeInfo::Decision { player, num_actions } = self.game.node(node) else {
            return Err(format!("node {node} is not a decision node"));
        };
        if self.game.locked_strategy(node).is_some() {
            return Err(format!("node {node} is locked; forced alternatives are outside the solved game"));
        }
        let &strategy_idx = self
            .by_node
            .get(&node)
            .ok_or_else(|| format!("missing stored strategy at decision node {node}"))?;
        let stored = &self.solution.nodes[strategy_idx];
        let combos = self.game.combo_count(node, player);
        if stored.strategy.len() != num_actions * combos {
            return Err(format!("node {node}: stored strategy has wrong shape"));
        }

        let opp_reach = self.reach(node, 1 - player, true)?;
        let mass = self.game.compatible_mass(node, player, &opp_reach);
        let mut action_evs = Vec::with_capacity(num_actions * combos);
        for action in 0..num_actions {
            let child = self.game.child(node, action);
            if self.game.combo_count(child, player) != combos
                || self.game.combo_count(child, 1 - player) != opp_reach.len()
            {
                return Err(format!(
                    "node {node} action {action}: decision edge changed combo axes"
                ));
            }
            let mut values = vec![0.0f32; combos];
            br::subtree_values(
                &self.game,
                child,
                player,
                &self.profile(),
                &opp_reach,
                false,
                &mut values,
            );
            for (v, &m) in values.into_iter().zip(&mass) {
                action_evs.push(if m > 0.0 { Some(v / m) } else { None });
            }
        }

        let combo_evs = self.combo_evs(node, player)?;
        let mut max_abs_diff = 0.0f32;
        let mut compared = 0usize;
        for combo in 0..combos {
            let Some(expected) = combo_evs[combo] else { continue };
            let mut mixed = 0.0f32;
            let mut defined = true;
            for action in 0..num_actions {
                let Some(ev) = action_evs[action * combos + combo] else {
                    defined = false;
                    break;
                };
                mixed += stored.strategy[action * combos + combo] * ev;
            }
            if defined {
                compared += 1;
                max_abs_diff = max_abs_diff.max((mixed - expected).abs());
            }
        }
        if compared == 0 {
            return Err(format!("node {node}: no combos with defined opponent-compatible mass"));
        }
        let identity = IdentityProof {
            compared_combos: compared,
            max_abs_diff,
            tolerance,
            passed: max_abs_diff <= tolerance,
        };
        if !identity.passed {
            return Err(format!(
                "node {node}: action-EV identity failed (max abs diff {} > tolerance {})",
                identity.max_abs_diff, identity.tolerance
            ));
        }

        Ok(ActionEvNode {
            version: "cash-pro-lab-action-combo-ev-v1",
            node,
            player,
            combo_count: combos,
            combo_indices: self.game.combo_indices(node, player).to_vec(),
            actions: stored.actions.clone(),
            strategy: stored.strategy.clone(),
            action_evs,
            combo_evs,
            identity,
            unit: "chips",
            convention: "zero_sum_net_chips_from_solve_start_forced_action_then_fixed_saved_average_strategy",
            certified_study: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine::config::SolveConfig;
    use engine::solution::{RootEvs, SolveMeta};

    fn fixture_solution() -> Solution {
        let cfg = SolveConfig::from_toml_str(
            r#"
board = "Qs Jh 2h 5c 9d"
oop_range = "TT+,AQs+,AKo"
ip_range = "99+,AJs+,AQo+"
effective_stack = 10.0
starting_pot = 5.0
allin_threshold = 67.0
raise_cap = 1
target_exploitability = 1.0
max_iterations = 10
turn_chance_sampling = false

[rake]
percent = 5.0
cap = 2.5

[sizings.oop.river]
bet = { percents = [50.0], allin = true }
[sizings.ip.river]
bet = { percents = [50.0], allin = true }
"#,
        )
        .expect("fixture config");
        let game = NlheGame::new(&cfg).expect("fixture game");
        let mut nodes = Vec::new();
        for node in 0..game.tree().len() as u32 {
            let NodeKind::Decision { player, actions } = &game.tree().node(node).kind else {
                continue;
            };
            let combos = game.live_combos(node, *player).len();
            let p = 1.0 / actions.len() as f32;
            nodes.push(NodeStrategy {
                node,
                player: *player,
                actions: actions.iter().map(|a| a.label.into()).collect(),
                combo_count: combos as u32,
                strategy: vec![p; actions.len() * combos],
            });
        }
        Solution {
            format_version: 1,
            config: cfg,
            meta: SolveMeta {
                iterations: 1,
                exploitability_chips: 0.0,
                exploitability_pct_of_pot: 0.0,
                root_evs: RootEvs { zero_sum: [0.0, 0.0], pot_share: [2.5, 2.5] },
                wall_seconds: 0.0,
                engine_version: "fixture".into(),
                payoff_unit: "chips".into(),
                gain: [0.0, 0.0],
            },
            node_count: game.tree().len() as u32,
            nodes,
            root_combos: [Vec::new(), Vec::new()],
        }
    }

    #[test]
    fn forced_action_evs_reconstruct_node_ev_under_stored_mix() {
        let extractor = ActionEvExtractor::new(fixture_solution()).expect("extractor");
        let root = extractor.game.root();
        let out = extractor.action_combo_evs(root, 1e-4).expect("action EVs");
        assert!(out.actions.len() >= 2);
        assert_eq!(out.action_evs.len(), out.actions.len() * out.combo_count);
        assert!(out.identity.passed);
        assert!(out.identity.compared_combos > 0);
        assert!(out.identity.max_abs_diff <= 1e-4);
        assert!(!out.certified_study);
    }
}

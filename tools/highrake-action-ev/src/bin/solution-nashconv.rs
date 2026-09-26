use std::collections::HashMap;
use std::env;

use engine::br::{self, StrategyProfile};
use engine::game::Game;
use engine::nlhe::NlheGame;
use engine::solution::{NodeStrategy, Solution};
use engine::tree::NodeKind;
use serde::Serialize;

struct FileProfile<'a> {
    nodes: &'a [NodeStrategy],
    by_node: &'a HashMap<u32, usize>,
}

impl StrategyProfile for FileProfile<'_> {
    fn strategy_into(&self, node: u32, out: &mut [f32]) {
        let &idx = self.by_node.get(&node).expect("validated profile node missing");
        out.copy_from_slice(&self.nodes[idx].strategy);
    }
}

#[derive(Serialize)]
struct Verification {
    version: &'static str,
    solution: String,
    iterations: u64,
    root_pot: f32,
    best_response: [f32; 2],
    expected_value: [f32; 2],
    gain: [f32; 2],
    nashconv_chips: f32,
    nashconv_pct_of_pot: f32,
    saved_chips: f32,
    saved_pct_of_pot: f32,
    saved_gain: [f32; 2],
    max_abs_meta_diff: f32,
    tolerance: f32,
    verified: bool,
    certified_study: bool,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 || args.len() > 4 {
        return Err("usage: solution-nashconv <solution.json> [out.json] [tolerance]".into());
    }
    let solution_path = &args[1];
    let out_path = args.get(2).filter(|s| !s.is_empty());
    let tolerance: f32 = args
        .get(3)
        .map(|s| s.parse::<f32>())
        .transpose()
        .map_err(|_| "tolerance must be a finite positive number")?
        .unwrap_or(1e-4);
    if !tolerance.is_finite() || tolerance <= 0.0 {
        return Err("tolerance must be a finite positive number".into());
    }

    let solution = Solution::load(solution_path)?;
    let game = NlheGame::new(&solution.config)?;
    if solution.node_count as usize != game.tree().len() {
        return Err(format!(
            "solution node_count {} != rebuilt tree {}",
            solution.node_count,
            game.tree().len()
        ).into());
    }

    let mut by_node = HashMap::with_capacity(solution.nodes.len());
    for (i, ns) in solution.nodes.iter().enumerate() {
        if by_node.insert(ns.node, i).is_some() {
            return Err(format!("duplicate decision node {}", ns.node).into());
        }
    }
    for node in 0..game.tree().len() as u32 {
        let NodeKind::Decision { player, actions } = &game.tree().node(node).kind else { continue };
        let &idx = by_node.get(&node).ok_or_else(|| format!("solution missing decision node {node}"))?;
        let ns = &solution.nodes[idx];
        let combos = game.combo_count(node, *player);
        if ns.player != *player
            || ns.combo_count as usize != combos
            || ns.actions.len() != actions.len()
            || ns.strategy.len() != actions.len() * combos
        {
            return Err(format!("solution/tree strategy shape mismatch at node {node}").into());
        }
    }

    let profile = FileProfile { nodes: &solution.nodes, by_node: &by_node };
    let best_response = [
        br::best_response_value(&game, 0, &profile),
        br::best_response_value(&game, 1, &profile),
    ];
    let expected_value = [
        br::expected_value(&game, 0, &profile),
        br::expected_value(&game, 1, &profile),
    ];
    let gain = [
        best_response[0] - expected_value[0],
        best_response[1] - expected_value[1],
    ];
    if gain.iter().any(|g| !g.is_finite() || *g < -1e-3) {
        return Err(format!("invalid unilateral gains {gain:?}").into());
    }
    let nashconv_chips = gain[0] + gain[1];
    let root_pot = game.root_pot();
    if !root_pot.is_finite() || root_pot <= 0.0 {
        return Err(format!("invalid root pot {root_pot}").into());
    }
    let nashconv_pct_of_pot = 100.0 * nashconv_chips / root_pot;

    let diffs = [
        (nashconv_chips - solution.meta.exploitability_chips).abs(),
        (nashconv_pct_of_pot - solution.meta.exploitability_pct_of_pot).abs(),
        (gain[0] - solution.meta.gain[0]).abs(),
        (gain[1] - solution.meta.gain[1]).abs(),
    ];
    let max_abs_meta_diff = diffs.into_iter().fold(0.0f32, f32::max);
    let verified = max_abs_meta_diff <= tolerance;
    let report = Verification {
        version: "cash-pro-lab-saved-profile-nashconv-v1",
        solution: solution_path.clone(),
        iterations: solution.meta.iterations,
        root_pot,
        best_response,
        expected_value,
        gain,
        nashconv_chips,
        nashconv_pct_of_pot,
        saved_chips: solution.meta.exploitability_chips,
        saved_pct_of_pot: solution.meta.exploitability_pct_of_pot,
        saved_gain: solution.meta.gain,
        max_abs_meta_diff,
        tolerance,
        verified,
        certified_study: false,
    };
    let json = serde_json::to_string_pretty(&report)?;
    if let Some(path) = out_path {
        std::fs::write(path, format!("{json}\n"))?;
    } else {
        println!("{json}");
    }
    if !verified {
        return Err(format!("saved-profile NashConv mismatch: max diff {max_abs_meta_diff} > {tolerance}").into());
    }
    Ok(())
}

use std::env;
use std::fs::File;
use std::io::{BufReader, Write};

use engine::config::SolveConfig;
use engine::nlhe::NlheGame;
use engine::solution::{ActionLabelData, NodeStrategy, RootCombo, SolveMeta};
use engine::tree::NodeKind;
use serde::de::{self, DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde::Serialize;

#[derive(Debug, Serialize)]
struct StreamProof {
    version: &'static str,
    format_version: u32,
    config: SolveConfig,
    meta: SolveMeta,
    node_count: u32,
    decision_nodes: u64,
    strategy_entries: u64,
    root_combo_counts: [usize; 2],
    structural_ok: bool,
}

#[derive(Debug, Default)]
struct NodeStats {
    decision_nodes: u64,
    strategy_entries: u64,
}

struct NodesSeed<'a> {
    game: &'a NlheGame,
}

struct NodesVisitor<'a> {
    game: &'a NlheGame,
}

impl<'de> DeserializeSeed<'de> for NodesSeed<'_> {
    type Value = NodeStats;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_seq(NodesVisitor { game: self.game })
    }
}

impl<'de> Visitor<'de> for NodesVisitor<'_> {
    type Value = NodeStats;

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("the solution decision-node array")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut stats = NodeStats::default();
        let mut last_node: Option<u32> = None;
        let tree_len = self.game.tree().len();
        let expected_decisions = (0..tree_len as u32)
            .filter(|&node| matches!(self.game.tree().node(node).kind, NodeKind::Decision { .. }))
            .count() as u64;

        while let Some(ns) = seq.next_element::<NodeStrategy>()? {
            if ns.node as usize >= tree_len {
                return Err(de::Error::custom(format!(
                    "decision node {} is outside rebuilt tree of {} nodes",
                    ns.node, tree_len
                )));
            }
            if let Some(prev) = last_node {
                if ns.node <= prev {
                    return Err(de::Error::custom(format!(
                        "decision nodes are not strictly increasing: {} after {}",
                        ns.node, prev
                    )));
                }
            }
            last_node = Some(ns.node);

            let NodeKind::Decision { player, actions } = &self.game.tree().node(ns.node).kind else {
                return Err(de::Error::custom(format!(
                    "stored decision node {} is not a decision in rebuilt tree",
                    ns.node
                )));
            };
            if ns.player != *player {
                return Err(de::Error::custom(format!(
                    "node {} player mismatch: file {} rebuilt {}",
                    ns.node, ns.player, player
                )));
            }
            let expected_actions: Vec<ActionLabelData> =
                actions.iter().map(|a| a.label.into()).collect();
            if ns.actions != expected_actions {
                return Err(de::Error::custom(format!(
                    "node {} action labels mismatch rebuilt tree",
                    ns.node
                )));
            }

            let combos = self.game.live_combos(ns.node, ns.player).len();
            if combos == 0 || ns.combo_count as usize != combos {
                return Err(de::Error::custom(format!(
                    "node {} combo_count mismatch: file {} rebuilt {}",
                    ns.node, ns.combo_count, combos
                )));
            }
            let action_count = ns.actions.len();
            let expected_len = action_count
                .checked_mul(combos)
                .ok_or_else(|| de::Error::custom("strategy length overflow"))?;
            if ns.strategy.len() != expected_len {
                return Err(de::Error::custom(format!(
                    "node {} strategy length {} != actions({}) * combos({})",
                    ns.node,
                    ns.strategy.len(),
                    action_count,
                    combos
                )));
            }
            for &p in &ns.strategy {
                if !p.is_finite() || p < -1e-6 || p > 1.0 + 1e-6 {
                    return Err(de::Error::custom(format!(
                        "node {} has invalid strategy probability {}",
                        ns.node, p
                    )));
                }
            }
            for combo in 0..combos {
                let mut sum = 0.0f32;
                for action in 0..action_count {
                    sum += ns.strategy[action * combos + combo];
                }
                if (sum - 1.0).abs() > 1e-3 {
                    return Err(de::Error::custom(format!(
                        "node {} combo {} strategy column sums to {}",
                        ns.node, combo, sum
                    )));
                }
            }

            stats.decision_nodes += 1;
            stats.strategy_entries += ns.strategy.len() as u64;
        }

        if stats.decision_nodes != expected_decisions {
            return Err(de::Error::custom(format!(
                "decision-node count {} != rebuilt tree {}",
                stats.decision_nodes, expected_decisions
            )));
        }
        Ok(stats)
    }
}

struct ProofSeed;

struct ProofVisitor;

impl<'de> DeserializeSeed<'de> for ProofSeed {
    type Value = StreamProof;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_map(ProofVisitor)
    }
}

impl<'de> Visitor<'de> for ProofVisitor {
    type Value = StreamProof;

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("a postflop solution JSON object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut format_version: Option<u32> = None;
        let mut config: Option<SolveConfig> = None;
        let mut game: Option<NlheGame> = None;
        let mut meta: Option<SolveMeta> = None;
        let mut node_count: Option<u32> = None;
        let mut node_stats: Option<NodeStats> = None;
        let mut root_combo_counts: Option<[usize; 2]> = None;

        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "format_version" => {
                    if format_version.is_some() {
                        return Err(de::Error::duplicate_field("format_version"));
                    }
                    format_version = Some(map.next_value()?);
                }
                "config" => {
                    if config.is_some() {
                        return Err(de::Error::duplicate_field("config"));
                    }
                    let value: SolveConfig = map.next_value()?;
                    let rebuilt = NlheGame::new(&value).map_err(de::Error::custom)?;
                    game = Some(rebuilt);
                    config = Some(value);
                }
                "meta" => {
                    if meta.is_some() {
                        return Err(de::Error::duplicate_field("meta"));
                    }
                    meta = Some(map.next_value()?);
                }
                "node_count" => {
                    if node_count.is_some() {
                        return Err(de::Error::duplicate_field("node_count"));
                    }
                    node_count = Some(map.next_value()?);
                }
                "nodes" => {
                    if node_stats.is_some() {
                        return Err(de::Error::duplicate_field("nodes"));
                    }
                    let g = game.as_ref().ok_or_else(|| {
                        de::Error::custom("solution config must precede nodes in persisted JSON")
                    })?;
                    node_stats = Some(map.next_value_seed(NodesSeed { game: g })?);
                }
                "root_combos" => {
                    if root_combo_counts.is_some() {
                        return Err(de::Error::duplicate_field("root_combos"));
                    }
                    let roots: [Vec<RootCombo>; 2] = map.next_value()?;
                    if roots[0].is_empty() || roots[1].is_empty() {
                        return Err(de::Error::custom("root combo lists must both be non-empty"));
                    }
                    root_combo_counts = Some([roots[0].len(), roots[1].len()]);
                }
                _ => {
                    map.next_value::<de::IgnoredAny>()?;
                }
            }
        }

        let format_version = format_version.ok_or_else(|| de::Error::missing_field("format_version"))?;
        if !(1..=3).contains(&format_version) {
            return Err(de::Error::custom(format!(
                "unsupported format_version {format_version}"
            )));
        }
        let config = config.ok_or_else(|| de::Error::missing_field("config"))?;
        let game = game.ok_or_else(|| de::Error::custom("rebuilt game missing"))?;
        let meta = meta.ok_or_else(|| de::Error::missing_field("meta"))?;
        let node_count = node_count.ok_or_else(|| de::Error::missing_field("node_count"))?;
        if node_count as usize != game.tree().len() {
            return Err(de::Error::custom(format!(
                "node_count {} != rebuilt tree {}",
                node_count,
                game.tree().len()
            )));
        }
        let node_stats = node_stats.ok_or_else(|| de::Error::missing_field("nodes"))?;
        let root_combo_counts =
            root_combo_counts.ok_or_else(|| de::Error::missing_field("root_combos"))?;

        Ok(StreamProof {
            version: "cash-pro-lab-solution-stream-proof-v1",
            format_version,
            config,
            meta,
            node_count,
            decision_nodes: node_stats.decision_nodes,
            strategy_entries: node_stats.strategy_entries,
            root_combo_counts,
            structural_ok: true,
        })
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 || args.len() > 3 {
        return Err("usage: solution-proof <solution.json> [proof.json]".into());
    }
    let input = File::open(&args[1])?;
    let mut deserializer = serde_json::Deserializer::from_reader(BufReader::new(input));
    let proof = ProofSeed.deserialize(&mut deserializer)?;
    deserializer.end()?;
    let json = serde_json::to_string_pretty(&proof)?;
    if let Some(path) = args.get(2) {
        std::fs::write(path, format!("{json}\n"))?;
    } else {
        let mut stdout = std::io::stdout().lock();
        writeln!(stdout, "{json}")?;
    }
    Ok(())
}

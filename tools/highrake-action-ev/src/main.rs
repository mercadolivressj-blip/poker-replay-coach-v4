use std::env;
use std::fs::File;
use std::io::{self, BufReader, Write};

use cash_pro_lab_action_ev::ActionEvExtractor;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 || args.len() > 5 {
        return Err("usage: cash-pro-lab-action-ev <solution.json> <node-id> [out.json] [tolerance]".into());
    }
    let solution_path = &args[1];
    let node: u32 = args[2].parse().map_err(|_| "node-id must be an unsigned integer")?;
    let out_path = args.get(3).filter(|s| !s.is_empty());
    let tolerance: f32 = args
        .get(4)
        .map(|s| s.parse::<f32>())
        .transpose()
        .map_err(|_| "tolerance must be a finite positive number")?
        .unwrap_or(1e-4);

    let file = File::open(solution_path)?;
    let extractor = ActionEvExtractor::from_reader(BufReader::new(file))?;
    let report = extractor.action_combo_evs(node, tolerance)?;
    let json = serde_json::to_string_pretty(&report)?;
    match out_path {
        Some(path) => std::fs::write(path, format!("{json}\n"))?,
        None => {
            let mut stdout = io::stdout().lock();
            writeln!(stdout, "{json}")?;
        }
    }
    Ok(())
}

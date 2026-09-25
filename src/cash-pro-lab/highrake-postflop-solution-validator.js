const finite=v=>typeof v==='number'&&Number.isFinite(v);
const near=(a,b,tol=1e-6)=>finite(Number(a))&&finite(Number(b))&&Math.abs(Number(a)-Number(b))<=tol;

function actionCount(node){return Array.isArray(node?.actions)?node.actions.length:0;}
function strategyShape(node){
  const actions=actionCount(node),combos=Number(node?.combo_count),strategy=node?.strategy;
  if(!actions||!Number.isInteger(combos)||combos<1||!Array.isArray(strategy)) return {ok:false,reason:'shape_missing'};
  if(strategy.length!==actions*combos) return {ok:false,reason:'strategy_length_mismatch'};
  if(strategy.some(v=>!finite(Number(v))||Number(v)<-1e-6||Number(v)>1+1e-6)) return {ok:false,reason:'strategy_probability_invalid'};
  for(let combo=0;combo<combos;combo++){
    let sum=0;
    for(let a=0;a<actions;a++) sum+=Number(strategy[a*combos+combo]);
    if(Math.abs(sum-1)>1e-3) return {ok:false,reason:'strategy_column_not_normalized'};
  }
  return {ok:true};
}
function sameString(a,b){return String(a??'')===String(b??'');}

export function validateHighRakePostflopSolution({solution,job}={}){
  const errors=[];
  if(!solution||typeof solution!=='object'||Array.isArray(solution)) errors.push('solution_not_object');
  if(!job||typeof job!=='object') errors.push('job_missing');
  if(errors.length) return {ok:false,errors,authority:null};

  const config=solution.config||{};
  const meta=solution.meta||{};
  const expected=job.root||{};
  const expectedRake=job.rake||{};
  if(!Number.isInteger(solution.format_version)||solution.format_version<1||solution.format_version>3) errors.push('format_version_unsupported');
  if(!sameString(config.board,expected.board?.join(' '))) errors.push('config_board_mismatch');
  if(!sameString(config.oop_range,job.expectedRanges?.oop)) errors.push('config_oop_range_mismatch');
  if(!sameString(config.ip_range,job.expectedRanges?.ip)) errors.push('config_ip_range_mismatch');
  if(!near(config.effective_stack,expected.effectiveStackBB)) errors.push('config_effective_stack_mismatch');
  if(!near(config.starting_pot,expected.potBB)) errors.push('config_starting_pot_mismatch');
  if(!near(config.rake?.percent,expectedRake.percent)) errors.push('config_rake_percent_mismatch');
  if(!near(config.rake?.cap,expectedRake.cap)) errors.push('config_rake_cap_mismatch');
  if(config.turn_chance_sampling!==false) errors.push('chance_sampling_must_be_false');
  if(!near(config.target_exploitability,job.convergence?.targetExploitabilityPct)) errors.push('target_exploitability_mismatch');

  if(meta.payoff_unit!=='chips') errors.push('payoff_unit_not_chips');
  if(!finite(Number(meta.exploitability_chips))||Number(meta.exploitability_chips)<0) errors.push('exploitability_chips_invalid');
  if(!finite(Number(meta.exploitability_pct_of_pot))||Number(meta.exploitability_pct_of_pot)<0) errors.push('exploitability_pct_invalid');
  else if(Number(meta.exploitability_pct_of_pot)>Number(job.convergence?.targetExploitabilityPct)+1e-6) errors.push('exploitability_target_not_met');
  if(!Number.isInteger(Number(meta.iterations))||Number(meta.iterations)<1) errors.push('iterations_invalid');
  if(!String(meta.engine_version||'').trim()) errors.push('engine_version_invalid');
  if(!Array.isArray(meta.root_evs?.zero_sum)||meta.root_evs.zero_sum.length!==2||meta.root_evs.zero_sum.some(v=>!finite(Number(v)))) errors.push('root_zero_sum_ev_invalid');
  if(!Array.isArray(meta.root_evs?.pot_share)||meta.root_evs.pot_share.length!==2||meta.root_evs.pot_share.some(v=>!finite(Number(v)))) errors.push('root_pot_share_ev_invalid');
  if(!Array.isArray(meta.gain)||meta.gain.length!==2||meta.gain.some(v=>!finite(Number(v))||Number(v)<-1e-7)) errors.push('best_response_gain_invalid');

  if(!Number.isInteger(solution.node_count)||solution.node_count<1) errors.push('node_count_invalid');
  if(!Array.isArray(solution.nodes)||!solution.nodes.length) errors.push('decision_nodes_missing');
  else{
    const seen=new Set();
    for(const node of solution.nodes){
      if(!Number.isInteger(node?.node)||node.node<0||node.node>=solution.node_count){errors.push('decision_node_index_invalid');continue;}
      if(seen.has(node.node)) errors.push('duplicate_decision_node'); else seen.add(node.node);
      if(![0,1].includes(node?.player)) errors.push('decision_node_player_invalid');
      const shape=strategyShape(node);
      if(!shape.ok) errors.push(`decision_node_${shape.reason}`);
    }
  }
  if(!Array.isArray(solution.root_combos)||solution.root_combos.length!==2||solution.root_combos.some(x=>!Array.isArray(x)||!x.length)) errors.push('root_combos_invalid');

  const unique=[...new Set(errors)];
  const strategyOracleReady=unique.length===0;
  return {
    version:'cash-pro-lab-highrake-postflop-solution-validation-v1',
    ok:strategyOracleReady,
    errors:unique,
    authority:{
      highRakeDomain:strategyOracleReady,
      strategyOracleReady,
      evAlternativeOracleReady:false,
      certifiedStudy:false,
      measuredExploitabilityPct:finite(Number(meta.exploitability_pct_of_pot))?Number(meta.exploitability_pct_of_pot):null,
      iterations:Number.isInteger(Number(meta.iterations))?Number(meta.iterations):null,
      reason:strategyOracleReady
        ?'Exact config and convergence envelope validated. Per-action alternative EV vectors are not persisted by the upstream solution schema, so EV-alternative authority remains blocked.'
        :'Solution failed exact-config, convergence or structure validation.',
    },
  };
}

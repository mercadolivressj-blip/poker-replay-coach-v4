import { BASELINE_META, baselineChart } from '../strategy-v1/ranges-100z.js';

const POSTFLOP_ORDER=['SB','BB','UTG','HJ','CO','BTN'];
const OPENERS=new Set(['UTG','HJ','CO','BTN','SB']);
const POSITIONS=new Set(['UTG','HJ','CO','BTN','SB','BB']);

export const RANGE_PROFILE_100Z_SRP=Object.freeze({
  profileId:`${BASELINE_META.version}-srp-rfi-call-v1`,
  baselineVersion:BASELINE_META.version,
  effectiveStackBB:BASELINE_META.effectiveStackBB,
  rakeProfile:'100z-high-rake',
  source:BASELINE_META.source,
  snapshotSha256:BASELINE_META.snapshotSha256,
  frequencyModel:BASELINE_META.frequencyModel,
  scope:'heads-up single-raised pots produced by one RFI and one defender call',
});

function fmtWeight(w){
  if(Math.abs(w-1)<1e-12)return'';
  return `:${Number(w.toFixed(4))}`;
}

export function chartActionRange(chart,action){
  if(!(chart instanceof Map)) return null;
  const parts=[];
  for(const [hand,dist] of chart.entries()){
    const pct=Number(dist?.[action]);
    if(!Number.isFinite(pct)||pct<=0)continue;
    const weight=Math.max(0,Math.min(1,pct/100));
    parts.push(`${hand}${fmtWeight(weight)}`);
  }
  return parts.join(',');
}

export function derive100zSrpRanges({openerPosition,defenderPosition}={}){
  const opener=String(openerPosition||'').toUpperCase();
  const defender=String(defenderPosition||'').toUpperCase();
  const errors=[];
  if(!OPENERS.has(opener))errors.push('unsupported_opener_position');
  if(!POSITIONS.has(defender)||defender===opener)errors.push('unsupported_defender_position');
  const openerChart=baselineChart(opener);
  const defenderChart=baselineChart(`${defender}:${opener}`);
  if(!openerChart)errors.push('opener_rfi_chart_missing');
  if(!defenderChart)errors.push('defender_vs_rfi_chart_missing');
  if(errors.length)return{ok:false,errors,profile:RANGE_PROFILE_100Z_SRP};
  const openerRange=chartActionRange(openerChart,'raise');
  const defenderRange=chartActionRange(defenderChart,'call');
  if(!openerRange)errors.push('opener_raise_range_empty');
  if(!defenderRange)errors.push('defender_call_range_empty');
  if(errors.length)return{ok:false,errors,profile:RANGE_PROFILE_100Z_SRP};

  const openerOrder=POSTFLOP_ORDER.indexOf(opener),defenderOrder=POSTFLOP_ORDER.indexOf(defender);
  if(openerOrder<0||defenderOrder<0)return{ok:false,errors:['postflop_position_order_missing'],profile:RANGE_PROFILE_100Z_SRP};
  const ipPosition=openerOrder>defenderOrder?opener:defender;
  const oopPosition=ipPosition===opener?defender:opener;
  return{
    ok:true,errors:[],profile:RANGE_PROFILE_100Z_SRP,openerPosition:opener,defenderPosition:defender,
    openerRange,defenderRange,ipPosition,oopPosition,
    rangeIp:ipPosition===opener?openerRange:defenderRange,
    rangeOop:oopPosition===opener?openerRange:defenderRange,
  };
}

export function infer100zSrpFromNode(node={}){
  const errors=[];
  if(node.game!=='NLHE_CASH_6MAX')errors.push('game_mismatch');
  if(node.currency!=='BB')errors.push('currency_mismatch');
  if(node.activePlayers!==2)errors.push('not_heads_up');
  if(Math.abs(Number(node.effectiveStackBB)-100)>0.01)errors.push('stack_not_100bb');
  if(node.rakeProfile!==RANGE_PROFILE_100Z_SRP.rakeProfile)errors.push('rake_profile_mismatch');
  if(node.strategyProfile&&node.strategyProfile!==RANGE_PROFILE_100Z_SRP.profileId)errors.push('strategy_profile_mismatch');
  const pre=(Array.isArray(node.actionHistory)?node.actionHistory:[]).filter(e=>e?.street==='preflop');
  const raises=pre.filter(e=>e?.action==='RAISE');
  const calls=pre.filter(e=>e?.action==='CALL');
  const aggressive=pre.filter(e=>['RAISE','ALLIN'].includes(e?.action));
  if(raises.length!==1||aggressive.length!==1)errors.push('not_single_rfi');
  if(calls.length!==1)errors.push('not_single_defender_call');
  const opener=raises[0]?.actorPosition;
  const defender=calls[0]?.actorPosition;
  if(!opener||!defender)errors.push('preflop_positions_missing');
  if(errors.length)return{ok:false,errors,profile:RANGE_PROFILE_100Z_SRP};
  const derived=derive100zSrpRanges({openerPosition:opener,defenderPosition:defender});
  if(!derived.ok)returnderived;
  return{...derived,nodeStrategyProfile:RANGE_PROFILE_100Z_SRP.profileId};
}

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));

export function terminalDecisionGate({
  street,
  selectedAction,
  rangeConfidence=0,
  oracleAvailable=false,
  oracleAgreement=false,
  policyAvailable=false,
  policyAgreement=false,
  playerExploitWeight=0,
  facingLargeBet=false,
  heroHandTier=0,
  boardCompletesDraw=false
}={}){
  const action=String(selectedAction||'').toUpperCase();
  const isAggressive=['BET','RAISE','ALLIN'].includes(action);
  const terminal=String(street||'').toLowerCase()==='river';
  let score=0;
  score += clamp(rangeConfidence)*0.35;
  score += oracleAvailable ? (oracleAgreement?0.30:-0.20) : 0;
  score += policyAvailable ? (policyAgreement?0.15:-0.08) : 0;
  score += clamp(playerExploitWeight)*0.10;
  score += !facingLargeBet ? 0.10 : 0;
  score=clamp(score);

  const reasons=[];
  if(terminal && isAggressive && facingLargeBet && boardCompletesDraw && heroHandTier<=2){
    if(!oracleAvailable) reasons.push('terminal_aggression_without_independent_oracle');
    if(oracleAvailable && !oracleAgreement) reasons.push('terminal_aggression_oracle_conflict');
    if(rangeConfidence<0.65) reasons.push('terminal_aggression_low_range_confidence');
  }
  if(terminal && isAggressive && oracleAvailable && !oracleAgreement) reasons.push('aggression_conflicts_with_oracle');

  const allowed = reasons.length===0 && (!terminal || !isAggressive || score>=0.55);
  return {allowed,score,reasons};
}

export function exploitGate({handsSeen=0,exploitWeight=0}={}){
  if(handsSeen<40) return {allowed:false,reason:'insufficient_hands'};
  if(exploitWeight<0.15) return {allowed:false,reason:'insufficient_profile_confidence'};
  return {allowed:true,reason:null};
}

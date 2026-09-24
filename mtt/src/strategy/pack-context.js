const n=v=>Number(v);
const near=(a,b,tol=1e-9)=>Number.isFinite(n(a))&&Number.isFinite(n(b))&&Math.abs(n(a)-n(b))<=tol;

export function preflopContextFromState(state){
 const bb=Number(state?.blinds?.big);
 if(!(bb>0))return null;
 return Object.freeze({
  smallBlindBB:Number(state.blinds.small)/bb,
  anteBB:Number(state.blinds.ante||0)/bb,
  anteType:String(state.blinds.anteType||'individual'),
  playersDealt:Number(state?.table?.playersDealt??state.tableSize),
  forcedPreflopPotBB:Number(state?.bb?.forcedPreflopPot)
 });
}

export function validatePreflopContext(ctx={}){
 const errors=[];
 if(!(n(ctx.smallBlindBB)>0))errors.push('small_blind_bb_invalid');
 if(!(n(ctx.anteBB)>=0))errors.push('ante_bb_invalid');
 if(!['individual','big_blind'].includes(String(ctx.anteType)))errors.push('ante_type_invalid');
 if(!Number.isInteger(n(ctx.playersDealt))||n(ctx.playersDealt)<2||n(ctx.playersDealt)>9)errors.push('players_dealt_invalid');
 if(!(n(ctx.forcedPreflopPotBB)>0))errors.push('forced_preflop_pot_bb_invalid');
 return{valid:errors.length===0,errors};
}

export function exactPreflopContextMatches(required,actual,tol=1e-9){
 if(!required||!actual)return false;
 return String(required.anteType)===String(actual.anteType)
  &&n(required.playersDealt)===n(actual.playersDealt)
  &&near(required.smallBlindBB,actual.smallBlindBB,tol)
  &&near(required.anteBB,actual.anteBB,tol)
  &&near(required.forcedPreflopPotBB,actual.forcedPreflopPotBB,tol);
}

export function contextPolicyMatches(meta,query){
 const policy=String(meta?.contextPolicy||'generic');
 if(policy==='generic')return true;
 if(policy==='exact-preflop-forced')return exactPreflopContextMatches(meta.preflopContext,query.preflopContext);
 return false;
}

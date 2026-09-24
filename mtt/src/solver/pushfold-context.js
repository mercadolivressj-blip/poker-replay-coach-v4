import {normalizePushFoldGame} from './pushfold-game.js';
import {validatePreflopContext} from '../strategy/pack-context.js';

export function pushFoldGameFromPreflopContext(ctx={}){
 const v=validatePreflopContext(ctx);if(!v.valid)throw new Error(`pushfold_context_invalid:${v.errors.join(',')}`);
 const sb=Number(ctx.smallBlindBB),ante=Number(ctx.anteBB),n=Number(ctx.playersDealt),type=String(ctx.anteType);
 let heroForcedBB=sb,villainForcedBB=1,deadMoneyBB=0;
 if(type==='individual'){
  heroForcedBB+=ante;villainForcedBB+=ante;deadMoneyBB=Math.max(0,n-2)*ante;
 }else if(type==='big_blind'){
  villainForcedBB+=ante;
 }
 const reconstructed=heroForcedBB+villainForcedBB+deadMoneyBB;
 if(Math.abs(reconstructed-Number(ctx.forcedPreflopPotBB))>1e-9)throw new Error(`pushfold_context_pot_mismatch:${reconstructed}:${ctx.forcedPreflopPotBB}`);
 return normalizePushFoldGame({effectiveStackBB:Number(ctx.effectiveStackBB),heroForcedBB,villainForcedBB,deadMoneyBB});
}

export function attachEffectiveStackToContext(ctx,effectiveStackBB){
 const S=Number(effectiveStackBB);if(!(S>0))throw new Error('effective_stack_bb_invalid');
 return Object.freeze({...ctx,effectiveStackBB:S});
}

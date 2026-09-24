import {all169,normalizeHandClass} from '../core/hand-class.js';
import {normalizePushFoldGame,bestResponseShove,bestResponseCall,verifyPushFoldProfile} from './pushfold-game.js';

const initMap=(hands,value)=>Object.fromEntries(hands.map(h=>[h,value]));

/**
 * Independent average-best-response solver for the same restricted push/fold game.
 * Deliberately separate from the regret-matching implementation so the two engines
 * can cross-check each other before a strategy pack is promoted.
 */
export function solvePushFoldFictitiousPlay({game,equityMatrix,hands=all169(),iterations=8000}={}){
 const g=normalizePushFoldGame(game),hs=[...new Set(hands.map(normalizeHandClass).filter(Boolean))];
 if(!hs.length)throw new Error('hands_empty');
 const shove=initMap(hs,1),call=initMap(hs,0);
 const n=Math.max(1,Math.floor(Number(iterations)||0));
 for(let t=1;t<=n;t++){
  const brCall=bestResponseCall({game:g,shoveStrategy:shove,equityMatrix,hands:hs});
  for(const h of hs)call[h]+=(brCall[h]-call[h])/t;
  const brShove=bestResponseShove({game:g,callStrategy:call,equityMatrix,hands:hs});
  for(const h of hs)shove[h]+=(brShove[h]-shove[h])/t;
 }
 const verification=verifyPushFoldProfile({game:g,shoveStrategy:shove,callStrategy:call,equityMatrix,hands:hs});
 return{game:'GENERIC_PUSH_FOLD_FICTITIOUS_PLAY',gameSpec:g,iterations:n,hands:hs,shoveStrategy:shove,callStrategy:call,...verification};
}

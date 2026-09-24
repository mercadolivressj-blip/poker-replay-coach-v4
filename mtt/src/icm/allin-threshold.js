import {icmWithBusted} from './icm.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

/**
 * Terminal heads-up call model inside a multi-player tournament table.
 * stacks = chips BEHIND before hero acts. potBeforeCall = currently contestable pot.
 * Hero index and villain index refer to stacks[]. Payouts must describe the current
 * remaining-player finish prizes, highest to lowest.
 */
export function terminalCallThreshold({stacks,payouts,heroIndex,villainIndex,potBeforeCall,callCost}){
 const s=stacks.map(Number),p=payouts.map(Number),h=Number(heroIndex),v=Number(villainIndex),pot=Number(potBeforeCall),call=Number(callCost);
 if(!Array.isArray(stacks)||s.length<2||p.length<s.length)throw new Error('icm_terminal_bad_table');
 if(!Number.isInteger(h)||!Number.isInteger(v)||h===v||!Number.isFinite(s[h])||!Number.isFinite(s[v])||s[h]<0||s[v]<0)throw new Error('icm_terminal_bad_seats');
 if(!Number.isFinite(pot)||pot<0||!Number.isFinite(call)||call<0||call>s[h])throw new Error('icm_terminal_bad_price');

 const fold=s.slice(); fold[v]+=pot;
 const win=s.slice(); win[h]=s[h]+pot; win[v]=s[v];
 const lose=s.slice(); lose[h]=s[h]-call; lose[v]=s[v]+pot+call;

 const foldEq=icmWithBusted(fold,p)[h];
 const winEq=icmWithBusted(win,p)[h];
 const loseEq=icmWithBusted(lose,p)[h];
 const denom=winEq-loseEq;
 const required=denom>0?clamp((foldEq-loseEq)/denom,0,1):1;
 const chipEvRequired=(pot+call)>0?call/(pot+call):1;
 return{
  heroIcm:{fold:foldEq,win:winEq,lose:loseEq},
  equityRequired:required,
  equityRequiredPct:required*100,
  chipEvRequired,
  chipEvRequiredPct:chipEvRequired*100,
  icmPremiumPct:(required-chipEvRequired)*100,
  modeledStacks:{fold,win,lose}
 };
}

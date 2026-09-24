import {positionsFor,normalizePosition} from './positions.js';
import {normalizeHistory,preflopPressure} from './action-history.js';
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function stackBucket(bb){
 const x=num(bb); if(x<8)return'<8'; if(x<12)return'8-12'; if(x<17)return'12-17'; if(x<25)return'17-25'; if(x<40)return'25-40'; if(x<60)return'40-60'; if(x<100)return'60-100'; return'100+';
}

export function phaseOf({entrants,remaining,paidSpots,tableSize=8}){
 const e=Math.max(0,num(entrants)),r=Math.max(0,num(remaining)),p=Math.max(0,num(paidSpots));
 if(r&&r<=tableSize)return'FINAL_TABLE';
 if(p&&r&&r<=p)return'ITM';
 if(p&&r&&r>p&&r<=p+Math.max(2,Math.ceil(p*.10)))return'BUBBLE';
 if(e&&r/e<=.15)return'LATE';
 if(e&&r/e<=.55)return'MIDDLE';
 return'EARLY';
}

export function normalizeTournamentState(raw={}){
 const tableSize=num(raw.tableSize,8),positions=positionsFor(tableSize),heroPosition=normalizePosition(raw.heroPosition||'BTN');
 if(!positions.includes(heroPosition))throw new Error(`hero_position_invalid:${heroPosition}`);
 const sb=Math.max(0,num(raw.smallBlind)),bb=Math.max(0,num(raw.bigBlind));
 if(bb<=0)throw new Error('big_blind_required');
 const ante=Math.max(0,num(raw.ante)),anteType=String(raw.anteType||'individual').toLowerCase(),playersDealt=Math.max(2,num(raw.playersDealt,tableSize));
 const heroStack=Math.max(0,num(raw.heroStack)),villainStack=Math.max(0,num(raw.villainStack,heroStack)),effective=Math.min(heroStack,villainStack||heroStack),pot=Math.max(0,num(raw.pot)),toCall=Math.max(0,num(raw.toCall)),heroCommitment=Math.max(0,num(raw.heroCommitment));
 const forcedPreflopPot=sb+bb+(anteType==='big_blind'?ante:ante*playersDealt);
 const state={game:'NLHE',format:'MTT',tableSize,positions,heroPosition,street:String(raw.street||'preflop').toLowerCase(),blinds:{small:sb,big:bb,ante,anteType,level:raw.level??null},chips:{heroStack,villainStack,effective,pot,toCall,heroCommitment,forcedPreflopPot},bb:{heroStack:heroStack/bb,villainStack:villainStack/bb,effective:effective/bb,pot:pot/bb,toCall:toCall/bb,heroCommitment:heroCommitment/bb,forcedPreflopPot:forcedPreflopPot/bb},tournament:{entrants:Math.max(0,num(raw.entrants)),remaining:Math.max(0,num(raw.remaining)),paidSpots:Math.max(0,num(raw.paidSpots)),avgStack:Math.max(0,num(raw.avgStack)),bountyType:String(raw.bountyType||'none').toLowerCase(),heroBounty:Math.max(0,num(raw.heroBounty)),villainBounty:Math.max(0,num(raw.villainBounty))},hand:String(raw.hand||'').trim().toUpperCase(),board:String(raw.board||'').trim(),history:normalizeHistory(raw.history||[]),legalActions:Array.isArray(raw.legalActions)?raw.legalActions.map(x=>String(x).toUpperCase()):[]};
 state.stackBucket=stackBucket(state.bb.effective); state.phase=phaseOf({...state.tournament,tableSize}); state.preflop=preflopPressure(state.history); state.spr=state.street==='preflop'||pot<=0?null:Math.max(0,heroStack-heroCommitment)/pot; state.fieldPct=state.tournament.entrants?clamp(state.tournament.remaining/state.tournament.entrants,0,1):null;
 return state;
}

export function readiness(state){
 const problems=[]; if(!state?.blinds?.big)problems.push('big_blind_missing'); if(!state?.heroPosition)problems.push('hero_position_missing'); if(!(state?.bb?.heroStack>=0))problems.push('hero_stack_missing'); if(state?.street!=='preflop'&&!state?.board)problems.push('board_missing_postflop'); if(!state?.legalActions?.length)problems.push('legal_actions_missing'); return{ready:!problems.length,problems};
}

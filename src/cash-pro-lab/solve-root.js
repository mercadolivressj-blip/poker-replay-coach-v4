import { derive100zSrpRanges, RANGE_PROFILE_100Z_SRP } from './range-profile-100z.js';

const CARD=/^[2-9TJQKA][hdcs]$/;
const POSITIONS=new Set(['UTG','HJ','CO','BTN','SB','BB']);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const RANKS='23456789TJQKA';
const SUITS='cdhs';
const cardIndex=card=>RANKS.indexOf(card[0])*4+SUITS.indexOf(card[1]);
const stable=value=>{
  if(Array.isArray(value))return`[${value.map(stable).join(',')}]`;
  if(value&&typeof value==='object')return`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
const fnv1a=text=>{let h=0x811c9dc5;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');};

function normalizeBoard(board=[]){
  return Array.isArray(board)?board.map(String).sort((a,b)=>cardIndex(b)-cardIndex(a)):[];
}

export function create100zSrpFlopSolveRoot(input={}){
  const board=normalizeBoard(input.board);
  const openerPosition=String(input.openerPosition||'').toUpperCase();
  const defenderPosition=String(input.defenderPosition||'').toUpperCase();
  const startingStackBB=Number(input.startingStackBB);
  const effectiveStackBB=Number(input.effectiveStackBB);
  const potBB=Number(input.potBB);
  const rakeProfile=String(input.rakeProfile||'');
  const strategyProfile=String(input.strategyProfile||'');
  const preflopModelProfile=String(input.preflopModelProfile||'');
  const ranges=derive100zSrpRanges({openerPosition,defenderPosition});
  const root={
    schemaVersion:'cash-pro-lab-solve-root-v1',
    fingerprintVersion:'cash-pro-lab-solve-root-fingerprint-v1',
    game:'NLHE_CASH_6MAX',currency:'BB',street:'flop',board,
    openerPosition,defenderPosition,startingStackBB,effectiveStackBB,potBB,
    rakeProfile,strategyProfile,preflopModelProfile,
    rangeProfileId:RANGE_PROFILE_100Z_SRP.profileId,
    rangeSnapshotSha256:RANGE_PROFILE_100Z_SRP.snapshotSha256,
    rangeIp:ranges.ok?ranges.rangeIp:null,
    rangeOop:ranges.ok?ranges.rangeOop:null,
    ipPosition:ranges.ok?ranges.ipPosition:null,
    oopPosition:ranges.ok?ranges.oopPosition:null,
    rangeErrors:ranges.ok?[]:[...ranges.errors],
    sourceRef:input.sourceRef?String(input.sourceRef):null,
  };
  const strategic={
    fingerprintVersion:root.fingerprintVersion,game:root.game,currency:root.currency,street:root.street,board:root.board,
    openerPosition,defenderPosition,startingStackBB,effectiveStackBB,potBB,rakeProfile,strategyProfile,preflopModelProfile,
    rangeProfileId:root.rangeProfileId,rangeSnapshotSha256:root.rangeSnapshotSha256,
  };
  root.fingerprint=`cplroot-${fnv1a(stable(strategic))}`;
  return root;
}

export function prove100zSrpFlopSolveRoot(root={}){
  const errors=[];
  if(root.schemaVersion!=='cash-pro-lab-solve-root-v1')errors.push('schema_invalid');
  if(root.game!=='NLHE_CASH_6MAX'||root.currency!=='BB')errors.push('game_or_currency_invalid');
  if(root.street!=='flop')errors.push('flop_root_required');
  if(!Array.isArray(root.board)||root.board.length!==3||root.board.some(c=>!CARD.test(c)))errors.push('board_invalid');
  if(new Set(root.board||[]).size!==(root.board||[]).length)errors.push('duplicate_board_card');
  if(!POSITIONS.has(root.openerPosition)||!POSITIONS.has(root.defenderPosition)||root.openerPosition===root.defenderPosition)errors.push('positions_invalid');
  if(!finite(root.startingStackBB)||root.startingStackBB<=0)errors.push('starting_stack_missing');
  if(Math.abs(Number(root.startingStackBB)-100)>0.01)errors.push('starting_stack_not_100bb');
  if(!finite(root.effectiveStackBB)||root.effectiveStackBB<=0)errors.push('effective_stack_missing');
  if(finite(root.startingStackBB)&&finite(root.effectiveStackBB)&&root.effectiveStackBB>root.startingStackBB+1e-9)errors.push('effective_stack_exceeds_starting_stack');
  if(!finite(root.potBB)||root.potBB<=0)errors.push('pot_missing');
  if(root.rakeProfile!==RANGE_PROFILE_100Z_SRP.rakeProfile)errors.push('rake_profile_mismatch');
  if(root.strategyProfile!==RANGE_PROFILE_100Z_SRP.profileId)errors.push('strategy_profile_mismatch');
  if(!root.preflopModelProfile)errors.push('preflop_model_profile_missing');
  if(root.rangeProfileId!==RANGE_PROFILE_100Z_SRP.profileId)errors.push('range_profile_mismatch');
  if(root.rangeSnapshotSha256!==RANGE_PROFILE_100Z_SRP.snapshotSha256)errors.push('range_snapshot_mismatch');
  if(!root.rangeIp||!root.rangeOop||root.rangeErrors?.length)errors.push('range_derivation_failed');
  return {version:'cash-pro-lab-solve-root-proof-v1',ok:errors.length===0,errors:[...new Set(errors)],fingerprint:root.fingerprint??null};
}

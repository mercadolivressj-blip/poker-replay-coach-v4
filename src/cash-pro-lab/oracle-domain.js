const finite=(v)=>typeof v==='number'&&Number.isFinite(v);
const lower=(v)=>String(v??'').trim().toLowerCase();

function includesExact(list,value){
  return Array.isArray(list)&&list.map(String).includes(String(value));
}

export function verifyOracleDomain(node={},domain={}){
  const reasons=[];
  if(!domain||typeof domain!=='object'||Array.isArray(domain)){
    return {ok:false,reasons:['domain_descriptor_missing'],checks:{}};
  }

  const checks={
    game:false,currency:false,stack:false,rake:false,street:false,players:false,evUnit:false,evSemantics:false,
  };

  checks.game=domain.game===node.game;
  if(!checks.game) reasons.push('domain_game_mismatch');

  checks.currency=domain.currency===node.currency;
  if(!checks.currency) reasons.push('domain_currency_mismatch');

  const stack=node.effectiveStackBB;
  const min=domain?.stackBB?.min;
  const max=domain?.stackBB?.max;
  checks.stack=finite(stack)&&finite(min)&&finite(max)&&stack>=min&&stack<=max;
  if(!checks.stack) reasons.push('domain_stack_mismatch');

  checks.rake=Boolean(node.rakeProfile)&&includesExact(domain.rakeProfiles,node.rakeProfile);
  if(!checks.rake) reasons.push('domain_rake_mismatch');

  checks.street=Array.isArray(domain.streets)&&domain.streets.includes(node.street);
  if(!checks.street) reasons.push('domain_street_mismatch');

  const active=node.activePlayers;
  const mode=lower(domain.playerMode);
  const minPlayers=Number.isInteger(domain.minPlayers)?domain.minPlayers:null;
  const maxPlayers=Number.isInteger(domain.maxPlayers)?domain.maxPlayers:null;
  const modeOk=mode==='heads-up'?active===2:mode==='multiway'?active>=3:mode==='any';
  const boundsOk=Number.isInteger(active)&&(minPlayers==null||active>=minPlayers)&&(maxPlayers==null||active<=maxPlayers);
  checks.players=modeOk&&boundsOk;
  if(!checks.players) reasons.push('domain_player_count_mismatch');

  checks.evUnit=domain.evUnit==='BB';
  if(!checks.evUnit) reasons.push('domain_ev_unit_mismatch');

  checks.evSemantics=domain.evSemantics==='action-ev-from-node';
  if(!checks.evSemantics) reasons.push('domain_ev_semantics_mismatch');

  return {
    version:'cash-pro-lab-oracle-domain-v1',
    ok:reasons.length===0,
    reasons,
    checks,
    resolved:{
      game:domain.game??null,
      currency:domain.currency??null,
      stackBB:{min:finite(min)?min:null,max:finite(max)?max:null},
      rakeProfiles:Array.isArray(domain.rakeProfiles)?[...domain.rakeProfiles]:[],
      streets:Array.isArray(domain.streets)?[...domain.streets]:[],
      playerMode:domain.playerMode??null,
      minPlayers,
      maxPlayers,
      evUnit:domain.evUnit??null,
      evSemantics:domain.evSemantics??null,
    },
  };
}

export function domainForNodeFixture(node={},overrides={}){
  const stack=finite(node.effectiveStackBB)?node.effectiveStackBB:100;
  return {
    game:node.game||'NLHE_CASH_6MAX',
    currency:node.currency||'BB',
    stackBB:{min:Math.max(1,stack-0.01),max:stack+0.01},
    rakeProfiles:node.rakeProfile?[node.rakeProfile]:[],
    streets:node.street?[node.street]:[],
    playerMode:node.activePlayers===2?'heads-up':node.activePlayers>=3?'multiway':'any',
    minPlayers:Number.isInteger(node.activePlayers)?node.activePlayers:null,
    maxPlayers:Number.isInteger(node.activePlayers)?node.activePlayers:null,
    evUnit:'BB',
    evSemantics:'action-ev-from-node',
    ...overrides,
  };
}

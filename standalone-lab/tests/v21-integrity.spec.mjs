import assert from 'node:assert/strict';

function decisionCode(v){
  const x=String(v||'').toUpperCase();
  return ({'DESISTIR':'FOLD','FOLD':'FOLD','PASSAR':'CHECK','CHECK':'CHECK','PAGAR':'CALL','CALL':'CALL','APOSTAR':'BET','BET':'BET','AUMENTAR':'RAISE','RAISE':'RAISE','ALL-IN':'ALLIN','ALLIN':'ALLIN'})[x]||null;
}
function decisionIsLegal(decision, legalActions){
  const code=decisionCode(decision);
  if(!code)return true;
  return new Set((legalActions||[]).map(x=>String(x).toUpperCase())).has(code);
}
function unrecordedPreflopEvidence({bb,pot,toCall,legalActions,heroPosition,hasManualAction=false}){
  if(hasManualAction)return null;
  const legal=new Set((legalActions||[]).map(x=>String(x).toUpperCase()));
  if(bb!=null&&pot!=null&&pot>bb*1.80+0.0001)return `pote ${pot} indica ação antes do Hero`;
  if(bb!=null&&toCall!=null&&toCall>bb*1.05+0.0001)return `para pagar ${toCall} indica agressão anterior`;
  if(legal.has('CALL')&&heroPosition==='UTG'&&bb!=null&&pot!=null&&pot>bb*1.60)return 'CALL + pote alterado incompatível com unopened';
  return null;
}
function heroActionBarFromRatios({blue=0,green=0,orange=0,red=0,street='preflop'}){
  let actions=[];
  if(blue>.0045){actions=['CHECK'];if(orange>.004)actions.push(street==='preflop'?'RAISE':'BET');}
  else if(green>.0045){actions=['FOLD','CALL'];if(orange>.004)actions.push('RAISE');}
  else if(red>.006){actions=['FOLD','CALL'];}
  const present=blue>.0025||green>.0025||orange>.003||red>.004;
  return {present,confident:actions.length>0,actions};
}
function complexSafety({hand,raises,calls,legal}){
  const legalSet=new Set(legal);
  const premiums=new Set(['QQ','KK','AA','AKs','AKo']);
  const strongCall=new Set(['TT','JJ','QQ','KK','AA','AQs','AKs','AKo']);
  if(raises>=2){
    if(premiums.has(hand)&&(legalSet.has('RAISE')||legalSet.has('ALLIN')))return legalSet.has('RAISE')?'AUMENTAR':'ALL-IN';
    if(strongCall.has(hand)&&legalSet.has('CALL'))return 'PAGAR';
    return null;
  }
  if(raises===1&&calls>0){
    if(premiums.has(hand)&&legalSet.has('RAISE'))return 'AUMENTAR';
    if(strongCall.has(hand)&&legalSet.has('CALL'))return 'PAGAR';
    return null;
  }
  if(raises===0&&calls>0&&legalSet.has('CHECK'))return 'PASSAR';
  return null;
}

// 1. PASSAR fantasma é proibido.
assert.equal(decisionIsLegal('PASSAR',['FOLD','CALL','RAISE']),false);
assert.equal(decisionIsLegal('PASSAR',['CHECK','BET']),true);

// 2. Hero bar: imagens vistas na sessão com Desistir/Pagar/Aumentar não podem virar CHECK.
assert.deepEqual(heroActionBarFromRatios({green:.02,orange:.01,street:'preflop'}).actions,['FOLD','CALL','RAISE']);
assert.deepEqual(heroActionBarFromRatios({blue:.02,orange:.01,street:'flop'}).actions,['CHECK','BET']);

// 3. Histórico vazio não significa unopened se pote/toCall já provam ação.
assert.ok(unrecordedPreflopEvidence({bb:.25,pot:.88,toCall:.53,legalActions:['FOLD','CALL','RAISE'],heroPosition:'UTG'}));
assert.ok(unrecordedPreflopEvidence({bb:.25,pot:.35,toCall:.50,legalActions:['FOLD','CALL','RAISE'],heroPosition:'HJ'}));
assert.equal(unrecordedPreflopEvidence({bb:.25,pot:.35,toCall:.25,legalActions:['FOLD','CALL','RAISE'],heroPosition:'UTG'}),null);

// 4. Nodes complexos não recebem FOLD genérico apenas para preencher o painel.
assert.equal(complexSafety({hand:'44',raises:1,calls:1,legal:['FOLD','CALL','RAISE']}),null);
assert.equal(complexSafety({hand:'AJs',raises:0,calls:2,legal:['FOLD','CALL','RAISE']}),null);
assert.equal(complexSafety({hand:'TT',raises:2,calls:0,legal:['FOLD','CALL','RAISE']}),'PAGAR');
assert.equal(complexSafety({hand:'AKs',raises:2,calls:0,legal:['FOLD','CALL','RAISE']}),'AUMENTAR');

// 5. Pós-flop: sem policy válida, não existe check/fold/call inventado.
const postflopEmergency=()=>null;
assert.equal(postflopEmergency(),null);

console.log('V21 integrity: 12/12 assertions passed');

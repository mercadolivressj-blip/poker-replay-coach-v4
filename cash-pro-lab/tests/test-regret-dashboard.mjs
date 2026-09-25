import assert from 'node:assert/strict';
import {buildRegretDashboard,promotionGate} from '../src/regret-dashboard.mjs';

const streets=['preflop','flop','turn','river'];
const positions=['UTG','HJ','CO','BTN','SB','BB'];
const depths=['20','40','75','100','150','200'];
const opponents=['BALANCED_REG','TIGHT_REG','AGGRO_REG','LAG_REG','TRICKY_REG'];
const nodes=['RFI','VS_OPEN','3BET_POT','SRP_CBET','TURN_BARREL','RIVER_POLAR'];

function record(i,{clean=false}={}){
  const street=streets[i%streets.length];
  const base=.2+(i%17)*.03;
  const actionEVs=street==='preflop'
    ? {FOLD:0,CALL:base,RAISE:base+.12}
    : street==='flop'
      ? {FOLD:0,CALL:base+.05,RAISE:base}
      : street==='turn'
        ? {FOLD:0,CALL:base-.03,RAISE:base+.08}
        : {FOLD:0,CALL:base+.10,RAISE:base-.12};
  const best=Object.entries(actionEVs).sort((a,b)=>b[1]-a[1])[0][0];
  let selected=best;
  if(!clean){
    // Inject deterministic mistakes, heavier on river, so the dashboard must find the leak.
    // Use FOLD as the injected mistake because the point of this fixture is to prove that
    // materially expensive errors trip the promotion gate; this is not a strategy claim.
    const wrong=(street==='river' && i%9===3) || (street!=='river' && i%41===7);
    if(wrong) selected='FOLD';
  }
  return {
    id:`d${i}`,street,position:positions[i%positions.length],depthBucket:depths[i%depths.length],
    node:nodes[i%nodes.length],opponentType:opponents[i%opponents.length],
    selectedAction:selected,actionEVs
  };
}

const records=Array.from({length:6000},(_,i)=>record(i));
const dash=buildRegretDashboard(records);
assert.equal(dash.overall.decisions,6000);
assert(dash.overall.totalRegretBB>0);
assert(Object.keys(dash.byStreet).length===4);
assert(Object.keys(dash.byPosition).length===6);
assert(dash.byStreet.river.avgRegretBB>dash.byStreet.flop.avgRegretBB);
assert(dash.highCost.length>0);
assert(dash.highCost[0].regretBB>=dash.highCost.at(-1).regretBB);
assert.equal(dash.unauditable.count,0);

const badGate=promotionGate(dash);
assert.equal(badGate.promotable,false);
assert(badGate.reasons.some(x=>['avg_regret_too_high','material_error_rate_too_high','severe_error_rate_too_high'].includes(x)));

const clean=buildRegretDashboard(Array.from({length:6000},(_,i)=>record(i,{clean:true})));
assert.equal(clean.overall.avgRegretBB,0);
assert.equal(clean.overall.materialRate,0);
assert.equal(promotionGate(clean).promotable,true);

const withMissing=[...Array.from({length:6000},(_,i)=>record(i,{clean:true})),...Array.from({length:200},(_,i)=>({
  id:`u${i}`,street:'river',position:'BB',depthBucket:'100',node:'RIVER_POLAR',opponentType:'BALANCED_REG',
  selectedAction:'CALL',actionEVs:{FOLD:0}
}))];
const missingDash=buildRegretDashboard(withMissing);
assert.equal(missingDash.unauditable.count,200);
const missingGate=promotionGate(missingDash);
assert.equal(missingGate.promotable,false);
assert(missingGate.reasons.includes('unauditable_rate_too_high'));

console.log('PASS — Cash Pro Lab V0.5 6000-decision regret dashboard / promotion gates');

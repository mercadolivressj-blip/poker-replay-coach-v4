import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectTexasSolverJson } from '../scripts/lib/cash-pro-lab-texassolver-schema.mjs';

const fixture={
  node_type:'action_node',player:1,actions:['CHECK','BET 4.0'],
  strategy:{qd7c:[0.34,0.66],AsKd:[1,0]},
  evs:{qd7c:[1.1,1.3],AsKd:[2.0,1.8]},
  childrens:{
    CHECK:{node_type:'chance_node',deal_number:2,dealcards:{'2c':{node_type:'action_node',player:0,actions:['CHECK','BET 2.0'],strategy:{AhKh:[0.5,0.5]}}}},
    'BET 4.0':{node_type:'terminal_node'},
  },
};

test('schema inspector discovers action nodes, strategies and optional EVs without certifying them',()=>{
  const report=inspectTexasSolverJson(fixture);
  assert.equal(report.actionNodes,2);
  assert.equal(report.actionNodeWithActions,2);
  assert.equal(report.actionNodeWithStrategy,2);
  assert.equal(report.actionNodeWithEvs,1);
  assert.equal(report.strategyCombos,3);
  assert.equal(report.evCombos,2);
  assert.equal(report.strategyShapeErrors,0);
  assert.equal(report.evShapeErrors,0);
  assert.equal(report.hasStrategy,true);
  assert.equal(report.hasEvs,true);
  assert.equal(report.oracleReady,false);
  assert.equal(report.certifiedStudy,false);
});

test('schema inspector surfaces strategy and EV shape mismatches instead of normalizing them',()=>{
  const report=inspectTexasSolverJson({node_type:'action_node',player:0,actions:['CHECK','BET 2.0'],strategy:{AsKs:[1]},evs:{AsKs:[1,'bad']}});
  assert.equal(report.strategyShapeErrors,1);
  assert.equal(report.evShapeErrors,1);
  assert.equal(report.strategyStructureHealthy,false);
  assert.equal(report.evStructureHealthy,false);
});

test('schema inspector does not mistake arbitrary JSON for solver strategy evidence',()=>{
  const report=inspectTexasSolverJson({hello:'world',nested:{x:1}});
  assert.equal(report.actionNodes,0);
  assert.equal(report.hasStrategy,false);
  assert.equal(report.hasEvs,false);
  assert.equal(report.oracleReady,false);
});

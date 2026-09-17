import assert from 'node:assert/strict';
import handler from '../api/brain.js';

const makeRes=()=>({
  statusCode:200,headers:{},body:null,
  setHeader(k,v){this.headers[k]=v;},
  end(v){this.body=v?JSON.parse(v):null;return this;},
});

const res=makeRes();
await handler({method:'GET',body:null},res);
assert.equal(res.statusCode,200);
assert.equal(res.body.ok,true);
assert.equal(res.body.frozenPolicyAvailable,false);
assert.equal(res.body.strategyStatus.policyComplete,false);
assert.notEqual(res.body.strategyStatus.postflop,'active');

console.log('brain API frozen-policy status: OK');

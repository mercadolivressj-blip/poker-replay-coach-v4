import assert from 'node:assert/strict';
import { LatestLane } from '../src/core/latest-lane.js';

const lane = new LatestLane('contract');
assert.equal(typeof lane.schedule, 'function');
assert.equal(typeof lane.run, 'function');
let ran = 0;
lane.run(async () => { ran++; });
await new Promise((r) => setTimeout(r, 0));
assert.equal(ran, 1, 'runtime .run() alias must execute the scheduled job');

let errors = 0;
lane.setErrorHandler(() => { errors++; });
lane.run(async () => { throw new Error('intentional'); });
await new Promise((r) => setTimeout(r, 0));
assert.equal(errors, 1, 'lane errors must be isolated and reported');

console.log('runtime contract regression passed');

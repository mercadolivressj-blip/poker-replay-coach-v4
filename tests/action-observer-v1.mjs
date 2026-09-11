import assert from 'node:assert/strict';
import handler from '../api/vision.js';

const makeRes = () => ({
  statusCode: 200,
  headers: {},
  body: null,
  setHeader(k, v) { this.headers[k] = v; },
  status(n) { this.statusCode = n; return this; },
  json(v) { this.body = v; return this; },
});

const oldFetch = global.fetch;
const oldKey = process.env.OPENAI_API_KEY;
const oldToken = process.env.VISION_ACCESS_TOKEN;
process.env.OPENAI_API_KEY = 'test-only';
process.env.VISION_ACCESS_TOKEN = 'secret-test';
let sent = null;

global.fetch = async (_url, opts) => {
  sent = JSON.parse(opts.body);
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        output_text: JSON.stringify({
          events: [
            { actorName: 'Vilao42', action: 'raise', amount: 1200, street: 'river', confidence: 0.94 },
            { actorName: 'Outro', action: 'fold', amount: null, street: 'river', confidence: 0.88 },
            { actorName: 'Duvidoso', action: 'call', amount: 1200, street: null, confidence: 0.2 },
          ],
          confidence: 0.91,
        }),
      };
    },
  };
};

let res = makeRes();
await handler({
  method: 'POST',
  headers: { 'x-coach-token': 'secret-test' },
  body: {
    kind: 'action_log',
    image: 'data:image/jpeg;base64,AA==',
    handId: 12,
    street: 'river',
    fingerprint: 'frame-1',
  },
}, res);

assert.equal(res.statusCode, 200);
assert.equal(sent.model, 'gpt-5.6-sol');
assert(sent.text.format.schema.properties.events);
assert.match(sent.input[0].content[0].text, /ONLY explicit textual action-history/i);
assert.match(sent.input[0].content[0].text, /Never guess opponent hole cards/i);
assert.equal(res.body.events.length, 2);
assert.equal(res.body.events[0].actorName, 'Vilao42');
assert.equal(res.body.events[0].action, 'raise');
assert.equal(res.body.events[0].amount, 1200);

res = makeRes();
await handler({
  method: 'POST',
  headers: { 'x-coach-token': 'secret-test' },
  body: { kind: 'action_log', image: 'data:image/jpeg;base64,AA==', handId: 13, street: 'showdown' },
}, res);
assert.equal(res.statusCode, 400);

if (oldFetch) global.fetch = oldFetch; else delete global.fetch;
if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
if (oldToken === undefined) delete process.env.VISION_ACCESS_TOKEN; else process.env.VISION_ACCESS_TOKEN = oldToken;

console.log('ACTION OBSERVER V1 Vision contract passed');

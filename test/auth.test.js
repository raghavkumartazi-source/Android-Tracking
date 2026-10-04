const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSecrets, constantTimeEqual, validSession, createLoginLimiter, SESSION_TTL } = require('../auth');
test('missing/default/weak credentials fail closed', () => {
  for (const env of [{}, { DASHBOARD_PIN: '1234', AGENT_KEY: 'x'.repeat(40) }, { DASHBOARD_PIN: 'a'.repeat(14), AGENT_KEY: 'change-me-to-a-secret'.repeat(2) }]) assert.throws(() => loadSecrets(env));
  assert.deepEqual(loadSecrets({ DASHBOARD_PIN: 'unique-passphrase', AGENT_KEY: 'x'.repeat(40) }), { pin: 'unique-passphrase', agentKey: 'x'.repeat(40) });
});
test('credential comparison accepts only the full string', () => { assert.equal(constantTimeEqual(null, 'x'), false); assert.equal(constantTimeEqual('abc', 'abcd'), false); assert.equal(constantTimeEqual('abcd', 'abcd'), true); });
test('HTTP and websocket share expiry and logout semantics', () => {
  const sessions = new Map([['token', { created: 100 }]]);
  assert.equal(validSession(sessions, 'token', 100 + SESSION_TTL - 1), true);
  assert.equal(validSession(sessions, 'token', 100 + SESSION_TTL), false);
  assert.equal(sessions.size, 0);
  sessions.set('token', { created: 100 }); sessions.delete('token'); assert.equal(validSession(sessions, 'token', 101), false);
});
test('login attempts are throttled and expire without unbounded memory', () => {
  let time = 0; const permit = createLoginLimiter({ now: () => time, limit: 2, windowMs: 100, capacity: 2 });
  assert.equal(permit('a'), true); assert.equal(permit('a'), true); assert.equal(permit('a'), false);
  assert.equal(permit('b'), true); assert.equal(permit('c'), false);
  time = 100; assert.equal(permit('c'), true); assert.equal(permit('a'), true);
});

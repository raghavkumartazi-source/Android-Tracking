const crypto = require('node:crypto');
const SESSION_TTL = 24 * 60 * 60 * 1000;
function constantTimeEqual(input, expected) {
  if (typeof input !== 'string' || typeof expected !== 'string') return false;
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(input).digest(), crypto.createHash('sha256').update(expected).digest());
}
function loadSecrets(env) {
  const pin = env.DASHBOARD_PIN;
  const agentKey = env.AGENT_KEY;
  if (typeof pin !== 'string' || pin.length < 12 || /^(1234|change.me|password)/i.test(pin)) throw new Error('Set DASHBOARD_PIN to a unique passphrase of at least 12 characters.');
  if (typeof agentKey !== 'string' || agentKey.length < 32 || /change.me/i.test(agentKey)) throw new Error('Set AGENT_KEY to a new random value of at least 32 characters.');
  if (constantTimeEqual(pin, agentKey)) throw new Error('Dashboard and agent credentials must be different.');
  return { pin, agentKey };
}
function validSession(sessions, token, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const session = sessions.get(token);
  if (!session || now - session.created >= SESSION_TTL) { sessions.delete(token); return false; }
  return true;
}
function createLoginLimiter({ now = Date.now, limit = 5, windowMs = 300000, capacity = 10000 } = {}) {
  const attempts = new Map();
  return key => {
    const time = now();
    for (const [id, state] of attempts) if (state.resetAt <= time) attempts.delete(id);
    if (!attempts.has(key) && attempts.size >= capacity) return false;
    const state = attempts.get(key) || { count: 0, resetAt: time + windowMs };
    attempts.set(key, state);
    return ++state.count <= limit;
  };
}
module.exports = { constantTimeEqual, loadSecrets, validSession, createLoginLimiter, SESSION_TTL };

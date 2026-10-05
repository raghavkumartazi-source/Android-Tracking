let token = null;
let timer = null;
const notice = document.getElementById('notice');
function clearSession(message) {
  token = null; clearInterval(timer); timer = null;
  document.getElementById('dashboard').hidden = true;
  document.getElementById('loginForm').hidden = false;
  document.getElementById('passphrase').value = '';
  notice.textContent = message;
}
async function refresh() {
  const current = token;
  try {
    const response = await fetch('/api/status', { headers: { Authorization: `Bearer ${current}` }, cache: 'no-store' });
    if (token !== current) return;
    if (response.status === 401) { clearSession('Session expired. Sign in again.'); return; }
    if (!response.ok) throw new Error('Health report is unavailable.');
    const data = await response.json();
    if (token !== current) return;
    document.getElementById('online').textContent = data.is_online ? 'Sharing' : 'Offline or sharing stopped';
    document.getElementById('battery').textContent = Number.isFinite(data.battery_level) && data.battery_level >= 0 ? `${data.battery_level}%` : 'Unavailable';
    document.getElementById('screen').textContent = data.is_screen_on ? 'On' : 'Off';
    document.getElementById('seen').textContent = data.last_seen ? new Date(data.last_seen).toLocaleString() : 'No reports yet';
    notice.textContent = '';
  } catch (error) { if (token === current) notice.textContent = error.message || 'Unable to refresh.'; }
}
document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.getElementById('loginBtn'); button.disabled = true;
  try {
    const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: document.getElementById('passphrase').value }) });
    const data = await response.json();
    if (!response.ok || !data.token) throw new Error(data.error || 'Sign-in failed.');
    token = data.token; document.getElementById('passphrase').value = '';
    document.getElementById('loginForm').hidden = true; document.getElementById('dashboard').hidden = false;
    clearInterval(timer); timer = setInterval(refresh, 15000); await refresh();
  } catch (error) { notice.textContent = error.message || 'Unable to sign in.'; }
  finally { button.disabled = false; }
});
document.getElementById('logoutBtn').addEventListener('click', async () => {
  const current = token;
  try {
    const response = await fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${current}` } });
    if (!response.ok) throw new Error('Unable to revoke your session. Try again.');
    clearSession('Signed out.');
  } catch (error) { notice.textContent = error.message; }
});

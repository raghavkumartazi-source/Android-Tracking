// ═══════════════════════════════════════════
//  BharatWatch — Dashboard Client
// ═══════════════════════════════════════════

const API = window.location.origin;
let authToken = localStorage.getItem('bw_token');
let ws = null;
let weeklyChart = null;
let categoryChart = null;

// ═══════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
    setupPinInputs();
    if (authToken) {
        const valid = await verifySession();
        if (valid) {
            showDashboard();
        } else {
            showLogin();
        }
    } else {
        showLogin();
    }
});

async function verifySession() {
    try {
        const res = await apiFetch('/api/verify');
        return res.valid === true;
    } catch {
        localStorage.removeItem('bw_token');
        authToken = null;
        return false;
    }
}

// ═══════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════
function setupPinInputs() {
    const inputs = document.querySelectorAll('.pin-digit');
    inputs.forEach((input, i) => {
        input.addEventListener('input', (e) => {
            const val = e.target.value.replace(/\D/g, '');
            e.target.value = val;
            if (val && i < inputs.length - 1) {
                inputs[i + 1].focus();
            }
            // Auto-submit when all filled
            if (i === inputs.length - 1 && val) {
                const pin = Array.from(inputs).map(inp => inp.value).join('');
                if (pin.length === inputs.length) handleLogin();
            }
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && i > 0) {
                inputs[i - 1].focus();
                inputs[i - 1].value = '';
            }
            if (e.key === 'Enter') handleLogin();
        });
        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const paste = (e.clipboardData.getData('text') || '').replace(/\D/g, '');
            paste.split('').forEach((ch, j) => {
                if (inputs[j]) inputs[j].value = ch;
            });
            const lastIdx = Math.min(paste.length, inputs.length) - 1;
            if (lastIdx >= 0) inputs[lastIdx].focus();
            if (paste.length >= inputs.length) handleLogin();
        });
    });
}

async function handleLogin() {
    const inputs = document.querySelectorAll('.pin-digit');
    const pin = Array.from(inputs).map(inp => inp.value).join('');
    const btn = document.getElementById('loginBtn');
    const error = document.getElementById('loginError');

    if (pin.length < 4) {
        error.textContent = 'Please enter the full PIN';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Verifying...';
    error.textContent = '';

    try {
        const res = await fetch(`${API}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin })
        });
        const data = await res.json();

        if (data.success) {
            authToken = data.token;
            localStorage.setItem('bw_token', authToken);
            showDashboard();
        } else {
            inputs.forEach(inp => {
                inp.value = '';
                inp.classList.add('error');
                setTimeout(() => inp.classList.remove('error'), 600);
            });
            inputs[0].focus();
            error.textContent = 'Invalid PIN. Try again.';
        }
    } catch (e) {
        error.textContent = 'Connection error. Is the server running?';
    }

    btn.disabled = false;
    btn.textContent = 'Unlock Dashboard';
}

async function handleLogout() {
    try { await apiFetch('/api/logout', 'POST'); } catch {}
    localStorage.removeItem('bw_token');
    authToken = null;
    if (ws) ws.close();
    showLogin();
}

function showLogin() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('dashboard').classList.add('hidden');
    const inputs = document.querySelectorAll('.pin-digit');
    inputs.forEach(inp => inp.value = '');
    setTimeout(() => inputs[0]?.focus(), 100);
}

function showDashboard() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    connectWebSocket();
    refreshAll();
}

// ═══════════════════════════════════════════
//  API HELPER
// ═══════════════════════════════════════════
async function apiFetch(path, method = 'GET', body = null) {
    const opts = {
        method,
        headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
        }
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${API}${path}`, opts);
    if (res.status === 401) {
        showLogin();
        throw new Error('Unauthorized');
    }
    return res.json();
}

// ═══════════════════════════════════════════
//  WEBSOCKET
// ═══════════════════════════════════════════
function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws/dashboard?token=${authToken}`;

    ws = new WebSocket(url);

    ws.onopen = () => {
        console.log('🟢 Dashboard WebSocket connected');
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleWSMessage(msg);
        } catch (e) {
            console.error('WS message error:', e);
        }
    };

    ws.onclose = () => {
        console.log('🔴 Dashboard WebSocket disconnected');
        // Auto-reconnect after 3s
        setTimeout(() => {
            if (authToken) connectWebSocket();
        }, 3000);
    };

    ws.onerror = () => {};
}

function handleWSMessage(msg) {
    switch (msg.type) {
        case 'init':
            updateStatus(msg.online, msg.status);
            break;
        case 'agent_online':
            updateStatus(true);
            showToast('BharatBook is now online', 'success');
            break;
        case 'agent_offline':
            updateStatus(false);
            showToast('BharatBook went offline', 'error');
            break;
        case 'heartbeat':
            updateHeartbeat(msg);
            break;
        case 'screenshot_ready':
            showToast('Screenshot captured!', 'success');
            loadScreenshots();
            break;
        case 'camera_photo_ready':
            showToast('Camera photo captured!', 'success');
            loadCameraPhotos();
            break;
        case 'apps_updated':
            loadApps();
            break;
        case 'activity':
            addLiveActivity(msg);
            break;
        case 'screen_time_updated':
            loadScreenTime();
            break;
        case 'device_locked':
            showToast('Device locked', 'info');
            break;
        case 'device_unlocked':
            showToast('Device unlocked', 'info');
            break;
        case 'blocked_apps_sync':
            loadBlockedApps();
            break;
        case 'blocked_attempt_alert':
            showToast(`🛑 Intercept Alert: ${msg.appName || msg.package} was blocked (${msg.reason})`, 'error');
            loadBlockedAttempts();
            break;
        case 'command_result':
            if (msg.success) {
                showToast(msg.result || 'Command executed', 'success');
            } else {
                showToast(msg.result || 'Command failed', 'error');
            }
            break;
        case 'web_activity':
            loadWebActivity();
            break;
    }
}

// ═══════════════════════════════════════════
//  STATUS UPDATES
// ═══════════════════════════════════════════
function updateStatus(online, status = null) {
    const pill = document.getElementById('statusPill');
    const text = document.getElementById('statusText');
    const statStatus = document.getElementById('statStatus');

    if (online) {
        pill.className = 'status-pill online';
        text.textContent = 'Online';
        statStatus.textContent = 'Online';
        statStatus.style.color = 'var(--success)';
    } else {
        pill.className = 'status-pill offline';
        text.textContent = 'Offline';
        statStatus.textContent = 'Offline';
        statStatus.style.color = 'var(--danger)';
    }

    if (status) {
        if (status.battery_level != null) {
            updateBattery(status.battery_level);
        }
        if (status.current_app) {
            updateCurrentApp(status.current_app, status.current_package);
        }
        if (status.last_seen) {
            document.getElementById('statLastSeen').textContent = `Last seen: ${formatTime(status.last_seen)}`;
            document.getElementById('lastSeenText').textContent = formatTime(status.last_seen);
        }
    }
}

function updateHeartbeat(msg) {
    if (msg.battery != null) updateBattery(msg.battery);
    if (msg.currentApp) updateCurrentApp(msg.currentApp, msg.currentPackage);
    if (msg.lastSeen) {
        document.getElementById('statLastSeen').textContent = `Last seen: ${formatTime(msg.lastSeen)}`;
        document.getElementById('lastSeenText').textContent = formatTime(msg.lastSeen);
    }

    // Update status to online
    const pill = document.getElementById('statusPill');
    if (!pill.classList.contains('online')) {
        updateStatus(true);
    }
}

function updateBattery(level) {
    const display = document.getElementById('batteryDisplay');
    const icon = document.getElementById('batteryIcon');
    const text = document.getElementById('batteryLevel');

    display.style.display = 'flex';
    text.textContent = `${level}%`;

    if (level <= 15) icon.textContent = '🪫';
    else if (level <= 50) icon.textContent = '🔋';
    else icon.textContent = '🔋';
}

function updateCurrentApp(appName, packageName) {
    const card = document.getElementById('currentAppCard');
    const nameEl = document.getElementById('currentAppName');
    const pkgEl = document.getElementById('currentAppPackage');
    const iconEl = document.getElementById('currentAppIcon');
    const badgeEl = document.getElementById('currentAppBadge');

    card.style.display = 'block';
    nameEl.textContent = appName;
    pkgEl.textContent = packageName || '';

    const category = categorizeApp(packageName);
    iconEl.className = `current-app-icon ${category}`;
    badgeEl.className = `current-app-badge ${category}`;
    badgeEl.textContent = category;

    const icons = { study: '📚', entertainment: '🎮', social: '💬', browser: '🌐', other: '📱' };
    iconEl.textContent = icons[category] || '📱';
}

// ═══════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════
function switchPage(page) {
    // Update nav
    document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.page === page);
    });

    // Update pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pageEl = document.getElementById(`${page}Page`);
    if (pageEl) pageEl.classList.add('active');

    // Update header title
    const titles = {
        overview: 'Overview',
        screenshots: 'Screenshots',
        activity: 'Activity Timeline',
        screentime: 'Screen Time',
        apps: 'Running Apps',
        web: 'Web Activity',
        camera: 'Camera Photos',
        controls: 'Parental Controls & App Blocker'
    };
    document.getElementById('headerTitle').textContent = titles[page] || page;

    // Load data for the page
    if (page === 'screenshots') loadScreenshots();
    if (page === 'camera') loadCameraPhotos();
    if (page === 'activity') loadActivities();
    if (page === 'screentime') loadScreenTime();
    if (page === 'apps') loadApps();
    if (page === 'web') loadWebActivity();
    if (page === 'controls') {
        loadTotalAppsList();
        loadBlockedApps();
        loadBlockedAttempts();
    }
}

// ═══════════════════════════════════════════
//  ACTIONS
// ═══════════════════════════════════════════
async function takeScreenshot() {
    const btn = document.getElementById('btnScreenshot');
    if (btn) btn.disabled = true;

    try {
        const res = await apiFetch('/api/screenshot', 'POST');
        if (res.success) {
            showToast('Screenshot requested...', 'info');
        } else {
            showToast(res.error || 'Failed', 'error');
        }
    } catch (e) {
        showToast('Failed to request screenshot', 'error');
    }

    setTimeout(() => { if (btn) btn.disabled = false; }, 3000);
}

async function takePhoto(cameraType = 'front') {
    const btn = document.getElementById(cameraType === 'back' ? 'btnCameraBack' : 'btnCameraFront');
    if (btn) btn.disabled = true;

    try {
        const res = await apiFetch('/api/take-photo', 'POST', { camera: cameraType });
        if (res.success) {
            showToast(`Requesting ${cameraType} camera capture...`, 'info');
        } else {
            showToast(res.error || 'Failed', 'error');
        }
    } catch (e) {
        showToast(`Failed to request ${cameraType} photo`, 'error');
    }

    setTimeout(() => { if (btn) btn.disabled = false; }, 3000);
}

async function lockDevice() {
    try {
        const res = await apiFetch('/api/lock', 'POST');
        if (res.success) showToast('Lock command sent', 'info');
        else showToast(res.error || 'Failed', 'error');
    } catch {
        showToast('Failed to lock device', 'error');
    }
}

async function unlockDevice() {
    try {
        const res = await apiFetch('/api/unlock', 'POST');
        if (res.success) showToast('Unlock command sent', 'info');
        else showToast(res.error || 'Failed', 'error');
    } catch {
        showToast('Failed to unlock device', 'error');
    }
}

async function refreshAll() {
    loadStatus();
    loadScreenshots();
    loadCameraPhotos();
    loadActivities();
    loadScreenTime();
    loadApps();
    loadWebActivity();
}

// ═══════════════════════════════════════════
//  LOAD STATUS
// ═══════════════════════════════════════════
async function loadStatus() {
    try {
        const status = await apiFetch('/api/status');
        updateStatus(status.is_online === 1, status);
    } catch {}
}

// ═══════════════════════════════════════════
//  LOAD SCREENSHOTS
// ═══════════════════════════════════════════
async function loadScreenshots() {
    try {
        const screenshots = await apiFetch('/api/screenshots?limit=1000');
        renderScreenshots(screenshots);
        renderRecentScreenshots(screenshots.slice(0, 4));
        document.getElementById('statScreenshots').textContent = screenshots.length;
    } catch {}
}

function renderScreenshots(screenshots) {
    const grid = document.getElementById('screenshotsGrid');
    if (!screenshots.length) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1">
                <div class="empty-icon">📸</div>
                <h3>No screenshots captured</h3>
                <p>Take a screenshot to see what's happening on the BharatBook</p>
            </div>`;
        return;
    }

    grid.innerHTML = screenshots.map(s => `
        <div class="card screenshot-card" onclick="openScreenshot('${s.filename}', '${formatTime(s.captured_at)}')">
            <div class="screenshot-thumb" style="position:relative;">
                <img src="/api/screenshots/file/${s.filename}?token=${authToken}" alt="Screenshot" loading="lazy">
                <div style="position:absolute; top:8px; left:8px; background:rgba(0,0,0,0.78); padding:3px 8px; border-radius:6px; font-size:0.75rem; color:${s.capture_type === 'auto_random' ? '#60a5fa' : '#f87171'}; border:1px solid rgba(255,255,255,0.15); backdrop-filter:blur(4px); font-weight:600;">
                    ${s.capture_type === 'auto_random' ? '⚡ Auto Random' : '🔴 Manual'}
                </div>
            </div>
            <div class="screenshot-meta" style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <div style="overflow:hidden;">
                    <span class="screenshot-time" style="display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${formatTime(s.captured_at)}</span>
                    <span class="screenshot-size" style="display:block;">${formatBytes(s.file_size)}</span>
                </div>
                <button class="btn btn-sm" onclick="event.stopPropagation(); downloadDirectFile('${s.filename}', 'screenshots');" title="Download Screenshot" style="padding:4px 8px; font-size:0.85rem; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); border-radius:6px; color:#fff; flex-shrink:0;">⬇️</button>
            </div>
        </div>
    `).join('');
}

function renderRecentScreenshots(screenshots) {
    const container = document.getElementById('recentScreenshots');
    if (!screenshots.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📸</div>
                <h3>No screenshots</h3>
                <p>Tap "Take Screenshot" to capture the current screen</p>
            </div>`;
        return;
    }

    container.innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px">
            ${screenshots.map(s => `
                <div class="screenshot-card card" style="padding:0;cursor:pointer" onclick="openScreenshot('${s.filename}', '${formatTime(s.captured_at)}')">
                    <div class="screenshot-thumb" style="aspect-ratio:16/10; position:relative;">
                        <img src="/api/screenshots/file/${s.filename}?token=${authToken}" alt="Screenshot" loading="lazy" style="width:100%;height:100%;object-fit:cover">
                        <div style="position:absolute; top:4px; left:4px; background:rgba(0,0,0,0.78); padding:2px 6px; border-radius:4px; font-size:0.65rem; color:${s.capture_type === 'auto_random' ? '#60a5fa' : '#f87171'}; border:1px solid rgba(255,255,255,0.15); backdrop-filter:blur(4px); font-weight:600;">
                            ${s.capture_type === 'auto_random' ? '⚡ Auto' : '🔴 Manual'}
                        </div>
                    </div>
                    <div style="padding:8px 10px; display:flex; justify-content:space-between; align-items:center;">
                        <span class="screenshot-time" style="font-size:0.6875rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${formatTime(s.captured_at)}</span>
                        <button class="btn btn-sm" onclick="event.stopPropagation(); downloadDirectFile('${s.filename}', 'screenshots');" title="Download Screenshot" style="padding:2px 6px; font-size:0.7rem; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); border-radius:4px; color:#fff;">⬇️</button>
                    </div>
                </div>
            `).join('')}
        </div>`;
}

let currentModalDownloadUrl = '';

function downloadModalImage() {
    if (!currentModalDownloadUrl) return;
    const a = document.createElement('a');
    a.href = currentModalDownloadUrl;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function downloadDirectFile(filename, folderType) {
    if (!authToken) return;
    const url = `/api/${folderType}/file/${filename}?token=${authToken}&download=1`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function openScreenshot(filename, time) {
    const modal = document.getElementById('screenshotModal');
    const img = document.getElementById('modalImage');
    const title = document.getElementById('modalTitle');

    img.src = `/api/screenshots/file/${filename}?token=${authToken}`;
    currentModalDownloadUrl = `/api/screenshots/file/${filename}?token=${authToken}&download=1`;
    title.textContent = `Screenshot — ${time}`;
    modal.classList.add('active');
}

function closeModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('screenshotModal').classList.remove('active');
}

// Close modal on Escape
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal({ target: document.getElementById('screenshotModal'), currentTarget: document.getElementById('screenshotModal') });
});

// ═══════════════════════════════════════════
//  LOAD CAMERA PHOTOS
// ═══════════════════════════════════════════
async function loadCameraPhotos() {
    try {
        const photos = await apiFetch('/api/camera-photos?limit=1000');
        renderCameraPhotos(photos);
        const statEl = document.getElementById('statCameraPhotos');
        if (statEl) statEl.textContent = photos.length;
    } catch {}
}

function renderCameraPhotos(photos) {
    const grid = document.getElementById('cameraGrid');
    if (!grid) return;
    if (!photos.length) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1">
                <div class="empty-icon">🤳</div>
                <h3>No camera photos captured</h3>
                <p>Use the capture buttons above to take silent photos</p>
            </div>`;
        return;
    }

    grid.innerHTML = photos.map(p => `
        <div class="card screenshot-card" onclick="openCameraPhoto('${p.filename}', '${formatTime(p.captured_at)}', '${p.camera_type || 'front'}')">
            <div class="screenshot-thumb">
                <img src="/api/camera-photos/file/${p.filename}?token=${authToken}" alt="Camera Photo" loading="lazy">
            </div>
            <div class="screenshot-meta" style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <div style="overflow:hidden;">
                    <span class="screenshot-time" style="display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${formatTime(p.captured_at)} (${(p.camera_type || 'front').toUpperCase()})</span>
                    <span class="screenshot-size" style="display:block;">${formatBytes(p.file_size)}</span>
                </div>
                <button class="btn btn-sm" onclick="event.stopPropagation(); downloadDirectFile('${p.filename}', 'camera-photos');" title="Download Camera Photo" style="padding:4px 8px; font-size:0.85rem; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); border-radius:6px; color:#fff; flex-shrink:0;">⬇️</button>
            </div>
        </div>
    `).join('');
}

function openCameraPhoto(filename, time, cameraType) {
    const modal = document.getElementById('screenshotModal');
    const img = document.getElementById('modalImage');
    const title = document.getElementById('modalTitle');

    img.src = `/api/camera-photos/file/${filename}?token=${authToken}`;
    currentModalDownloadUrl = `/api/camera-photos/file/${filename}?token=${authToken}&download=1`;
    title.textContent = `Camera Photo (${cameraType.toUpperCase()}) — ${time}`;
    modal.classList.add('active');
}

// ═══════════════════════════════════════════
//  LOAD ACTIVITIES
// ═══════════════════════════════════════════
async function loadActivities() {
    try {
        const data = await apiFetch('/api/activities?limit=100');
        renderFullActivities(data.activities);
        renderRecentActivities(data.activities.slice(0, 8));
        document.getElementById('statActivities').textContent = data.total;
        document.getElementById('activityCount').textContent = `${data.total} events`;
    } catch {}
}

function renderActivityItem(a) {
    const cat = categorizeApp(a.package_name);
    return `
        <li class="activity-item">
            <div class="activity-dot ${cat}"></div>
            <div class="activity-info">
                <div class="activity-name">${escapeHtml(a.app_name)}</div>
                <div class="activity-package">${escapeHtml(a.package_name || '')}</div>
            </div>
            <span class="activity-badge ${a.event_type === 'foreground' ? 'foreground' : 'background'}">${a.event_type}</span>
            <span class="activity-time">${formatTime(a.started_at)}</span>
        </li>`;
}

function renderFullActivities(activities) {
    const list = document.getElementById('fullActivityList');
    if (!activities.length) {
        list.innerHTML = `
            <li class="empty-state">
                <div class="empty-icon">📜</div>
                <h3>No activity recorded</h3>
                <p>App switch events will be logged here</p>
            </li>`;
        return;
    }
    list.innerHTML = activities.map(renderActivityItem).join('');
}

function renderRecentActivities(activities) {
    const list = document.getElementById('recentActivityList');
    if (!activities.length) {
        list.innerHTML = `
            <li class="empty-state">
                <div class="empty-icon">📜</div>
                <h3>No activity yet</h3>
                <p>Activity will appear here once the BharatBook agent connects</p>
            </li>`;
        return;
    }
    list.innerHTML = activities.map(renderActivityItem).join('');
}

function addLiveActivity(msg) {
    const cat = categorizeApp(msg.packageName);
    const item = `
        <li class="activity-item" style="animation: pageIn 0.3s var(--ease)">
            <div class="activity-dot ${cat}"></div>
            <div class="activity-info">
                <div class="activity-name">${escapeHtml(msg.appName)}</div>
                <div class="activity-package">${escapeHtml(msg.packageName || '')}</div>
            </div>
            <span class="activity-badge ${msg.eventType === 'foreground' ? 'foreground' : 'background'}">${msg.eventType}</span>
            <span class="activity-time">${formatTime(msg.timestamp)}</span>
        </li>`;

    // Add to recent
    const recent = document.getElementById('recentActivityList');
    const emptyCheck = recent.querySelector('.empty-state');
    if (emptyCheck) recent.innerHTML = '';
    recent.insertAdjacentHTML('afterbegin', item);
    // Keep max 8
    while (recent.children.length > 8) recent.removeChild(recent.lastChild);

    // Add to full
    const full = document.getElementById('fullActivityList');
    const emptyCheck2 = full.querySelector('.empty-state');
    if (emptyCheck2) full.innerHTML = '';
    full.insertAdjacentHTML('afterbegin', item);

    // Update current app
    if (msg.eventType === 'foreground') {
        updateCurrentApp(msg.appName, msg.packageName);
    }
}

// ═══════════════════════════════════════════
//  LOAD SCREEN TIME
// ═══════════════════════════════════════════
async function loadScreenTime(customDate = null) {
    try {
        const url = customDate ? `/api/screentime?date=${customDate}` : '/api/screentime';
        const data = await apiFetch(url);
        renderWeeklyChart(data.daily || []);
        renderCategoryChart(data.categories || []);
        renderCategoryList(data.categories || []);
        renderTopApps(data.apps || []);
        renderDetailedAnalysis(data);

        // Update stat on Overview card
        const localDate = customDate || new Date().toLocaleDateString('en-CA');
        const todayRow = (data.daily || []).find(d => d.date === localDate);
        const appsSum = (data.apps || []).reduce((sum, a) => sum + (a.total_seconds || 0), 0);
        const totalSeconds = todayRow ? Math.max(todayRow.total_seconds || 0, appsSum) : appsSum;

        const statElem = document.getElementById('statScreenTime');
        if (statElem) {
            statElem.textContent = formatDuration(totalSeconds);
        }

        const studyElem = document.getElementById('statScreenTimeSub');
        if (studyElem) {
            const studyTime = (data.categories || []).find(c => c.category === 'study');
            const studySec = studyTime ? studyTime.total_seconds : 0;
            studyElem.textContent = `Study: ${formatDuration(studySec)} • Resets daily at midnight`;
        }
    } catch (e) {
        console.error('Failed to load screen time:', e);
    }
}

function renderWeeklyChart(daily) {
    const ctx = document.getElementById('weeklyChart');
    if (!ctx) return;

    if (weeklyChart) weeklyChart.destroy();

    const labels = daily.map(d => {
        const date = new Date(d.date + 'T00:00:00');
        return date.toLocaleDateString('en-IN', { weekday: 'short' });
    });
    const values = daily.map(d => Math.round(d.total_seconds / 60)); // minutes

    weeklyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Minutes',
                data: values,
                backgroundColor: 'rgba(255, 255, 255, 0.25)',
                borderColor: 'rgba(255, 255, 255, 0.85)',
                borderWidth: 1,
                borderRadius: 6,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#080808',
                    titleColor: '#ffffff',
                    bodyColor: '#cccccc',
                    borderColor: 'rgba(255,255,255,0.15)',
                    borderWidth: 1,
                    cornerRadius: 8,
                    callbacks: {
                        label: ctx => formatDuration(ctx.raw * 60)
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#888888', font: { size: 11, family: 'Inter' } }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: {
                        color: '#888888',
                        font: { size: 11, family: 'Inter' },
                        callback: v => formatDuration(v * 60)
                    }
                }
            }
        }
    });
}

function renderCategoryChart(categories) {
    const ctx = document.getElementById('categoryChart');
    if (!ctx) return;

    if (categoryChart) categoryChart.destroy();

    if (!categories.length) {
        categoryChart = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: ['No Data'], datasets: [{ data: [1], backgroundColor: ['rgba(255,255,255,0.08)'] }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
        return;
    }

    const colorMap = {
        study: '#ffffff',
        entertainment: '#999999',
        social: '#dddddd',
        browser: '#666666',
        other: '#333333'
    };

    categoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: categories.map(c => (c.category || 'other').charAt(0).toUpperCase() + (c.category || 'other').slice(1)),
            datasets: [{
                data: categories.map(c => c.total_seconds),
                backgroundColor: categories.map(c => colorMap[c.category] || colorMap.other),
                borderWidth: 0,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#aaaaaa',
                        font: { size: 11, family: 'Inter' },
                        padding: 12,
                        usePointStyle: true,
                        pointStyleWidth: 8
                    }
                },
                tooltip: {
                    backgroundColor: '#080808',
                    titleColor: '#ffffff',
                    bodyColor: '#cccccc',
                    borderColor: 'rgba(255,255,255,0.15)',
                    borderWidth: 1,
                    cornerRadius: 8,
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${formatDuration(ctx.raw)}`
                    }
                }
            }
        }
    });
}

function renderCategoryList(categories) {
    const list = document.getElementById('categoryList');
    if (!categories.length) {
        list.innerHTML = '<li class="empty-state"><p>No screen time data</p></li>';
        return;
    }

    const maxSeconds = Math.max(...categories.map(c => c.total_seconds));

    list.innerHTML = categories.map(c => {
        const cat = c.category || 'other';
        const pct = maxSeconds > 0 ? (c.total_seconds / maxSeconds) * 100 : 0;
        return `
            <li class="category-item">
                <div class="category-color ${cat}"></div>
                <span class="category-name">${cat}</span>
                <div class="category-bar">
                    <div class="category-bar-fill ${cat}" style="width:${pct}%"></div>
                </div>
                <span class="category-time">${formatDuration(c.total_seconds)}</span>
            </li>`;
    }).join('');
}

function renderTopApps(apps) {
    const list = document.getElementById('topAppsList');
    if (!apps.length) {
        list.innerHTML = '<li class="empty-state"><p>No app usage data</p></li>';
        return;
    }

    list.innerHTML = apps.slice(0, 10).map((a, i) => `
        <li class="app-usage-item">
            <span class="app-usage-rank">${i + 1}</span>
            <span class="app-usage-name">${escapeHtml(a.app_name)}</span>
            <span class="app-usage-time">${formatDuration(a.total_seconds)}</span>
        </li>
    `).join('');
}

function loadScreenTimeForDate(dateStr) {
    if (dateStr) {
        loadScreenTime(dateStr);
    }
}

function renderDetailedAnalysis(data) {
    const apps = data.apps || [];
    const categories = data.categories || [];
    const totalSec = apps.reduce((sum, a) => sum + (a.total_seconds || 0), 0);

    const getCatSec = (name) => {
        const row = categories.find(c => (c.category || '').toLowerCase() === name.toLowerCase());
        return row ? (row.total_seconds || 0) : 0;
    };

    const studySec = getCatSec('study');
    const socialSec = getCatSec('social');
    const entSec = getCatSec('entertainment');
    const otherSec = Math.max(0, totalSec - (studySec + socialSec + entSec));

    const studyPct = totalSec > 0 ? (studySec / totalSec) * 100 : 0;
    const socialPct = totalSec > 0 ? (socialSec / totalSec) * 100 : 0;
    const entPct = totalSec > 0 ? (entSec / totalSec) * 100 : 0;
    const otherPct = totalSec > 0 ? Math.max(0, 100 - (studyPct + socialPct + entPct)) : 0;

    // Focus Score calculation (Study carries positive weight, social/ent carry negative friction, other neutral)
    let score = 50;
    if (totalSec > 0) {
        const productiveRatio = (studySec + (otherSec * 0.4)) / totalSec;
        const distractionRatio = (socialSec + entSec) / totalSec;
        score = Math.round(Math.min(100, Math.max(0, (productiveRatio * 85) + ((1 - distractionRatio) * 15))));
    } else {
        score = 100; // Fresh day reset
    }

    const valEl = document.getElementById('focusScoreValue');
    const badgeEl = document.getElementById('focusScoreBadge');
    const summaryEl = document.getElementById('focusScoreSummary');
    const totalEl = document.getElementById('focusTotalSummary');

    if (valEl) valEl.textContent = `${totalSec > 0 ? score : '--'} / 100`;
    if (totalEl) totalEl.textContent = `Total Today: ${formatDuration(totalSec)}`;

    if (badgeEl) {
        if (totalSec === 0) {
            badgeEl.textContent = 'Day Reset • No Activity Yet';
            badgeEl.style.background = 'rgba(255,255,255,0.1)';
        } else if (score >= 75) {
            badgeEl.textContent = '🌟 Highly Focused';
            badgeEl.style.background = 'rgba(46, 213, 115, 0.2)';
            badgeEl.style.color = '#2ed573';
        } else if (score >= 50) {
            badgeEl.textContent = '⚖️ Balanced Day';
            badgeEl.style.background = 'rgba(30, 144, 255, 0.2)';
            badgeEl.style.color = '#1e90ff';
        } else {
            badgeEl.textContent = '📱 Leisure Intensive';
            badgeEl.style.background = 'rgba(255, 71, 87, 0.2)';
            badgeEl.style.color = '#ff4757';
        }
    }

    if (summaryEl) {
        if (totalSec === 0) {
            summaryEl.textContent = 'Counters reset daily at midnight. Activity will analyze as you use apps.';
        } else if (studySec > entSec && studySec > socialSec) {
            summaryEl.textContent = `Study time (${formatDuration(studySec)}) leads your daily activity! Great productivity momentum.`;
        } else if (socialSec + entSec > studySec * 2) {
            summaryEl.textContent = `Social & Media account for ${Math.round(socialPct + entPct)}% of today's screen time.`;
        } else {
            summaryEl.textContent = `Activity is distributed across ${apps.length} tracked apps today.`;
        }
    }

    const barStudy = document.getElementById('barStudy');
    const barSocial = document.getElementById('barSocial');
    const barEnt = document.getElementById('barEntertainment');
    const barOther = document.getElementById('barOther');

    if (barStudy) barStudy.style.width = `${studyPct}%`;
    if (barSocial) barSocial.style.width = `${socialPct}%`;
    if (barEnt) barEnt.style.width = `${entPct}%`;
    if (barOther) barOther.style.width = `${otherPct}%`;

    const iStudy = document.getElementById('insightStudyTime');
    const iSocial = document.getElementById('insightSocialTime');
    const iEnt = document.getElementById('insightEntTime');
    const iTop = document.getElementById('insightTopActivity');

    if (iStudy) iStudy.textContent = `${formatDuration(studySec)} (${Math.round(studyPct)}%)`;
    if (iSocial) iSocial.textContent = `${formatDuration(socialSec)} (${Math.round(socialPct)}%)`;
    if (iEnt) iEnt.textContent = `${formatDuration(entSec)} (${Math.round(entPct)}%)`;

    if (iTop) {
        if (apps.length > 0) {
            const top = apps[0];
            const topPct = totalSec > 0 ? Math.round((top.total_seconds / totalSec) * 100) : 0;
            iTop.textContent = `${top.app_name} (${formatDuration(top.total_seconds)} — ${topPct}% of day)`;
            iTop.title = `${top.app_name} is your most active app today`;
        } else {
            iTop.textContent = 'No app usage recorded today yet';
        }
    }
}

// ═══════════════════════════════════════════
//  LOAD RUNNING APPS
// ═══════════════════════════════════════════
async function loadApps() {
    try {
        const apps = await apiFetch('/api/apps');
        renderApps(apps);
    } catch {}
}

function renderApps(apps) {
    const grid = document.getElementById('appsGrid');
    const count = document.getElementById('appsCount');

    if (!apps.length) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1">
                <div class="empty-icon">📱</div>
                <h3>No app data</h3>
                <p>Running apps will appear here when the BharatBook agent reports them</p>
            </div>`;
        count.textContent = '0 apps running';
        return;
    }

    count.textContent = `${apps.length} apps running`;
    document.getElementById('appsLastUpdate').textContent = `Updated: ${formatTime(apps[0]?.reported_at)}`;

    const colorMap = {
        study: { bg: 'rgba(255,255,255,0.12)', color: '#ffffff' },
        entertainment: { bg: 'rgba(255,255,255,0.08)', color: '#cccccc' },
        social: { bg: 'rgba(255,255,255,0.08)', color: '#dddddd' },
        browser: { bg: 'rgba(255,255,255,0.06)', color: '#aaaaaa' },
        other: { bg: 'rgba(255,255,255,0.05)', color: '#888888' }
    };
    const icons = { study: '📚', entertainment: '🎮', social: '💬', browser: '🌐', other: '📱' };

    grid.innerHTML = apps.map(a => {
        const cat = categorizeApp(a.package_name);
        const c = colorMap[cat] || colorMap.other;
        return `
            <div class="card app-card">
                <div class="app-card-icon" style="background:${c.bg};color:${c.color}">
                    ${icons[cat] || '📱'}
                </div>
                <div class="app-card-info">
                    <div class="app-card-name">${escapeHtml(a.app_name)}</div>
                    <div class="app-card-package">${escapeHtml(a.package_name || '')}</div>
                </div>
                <div style="display:flex; align-items:center; gap:0.5rem;">
                    <span class="app-card-badge ${a.is_foreground ? 'fg' : 'bg'}">${a.is_foreground ? 'FG' : 'BG'}</span>
                    <button class="btn btn-sm" onclick="openAddRuleModal('${escapeHtml(a.package_name || '')}', '${escapeHtml(a.app_name || '')}')" style="background:rgba(255,107,107,0.15); color:#ff6b6b; border:1px solid rgba(255,107,107,0.3); padding:0.2rem 0.5rem; font-size:0.72rem; border-radius:6px; cursor:pointer;" title="Restrict this app">🛑 Block</button>
                </div>
            </div>`;
    }).join('');
}

// ═══════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════
function categorizeApp(packageName) {
    if (!packageName) return 'other';
    const pkg = packageName.toLowerCase();
    if (/edu|learn|study|school|book|read|course|class|math|science|khan|byju|unacademy|toppr|vedantu|doubtnut|brainly|quizlet|notion|evernote|onenote|google\.docs|sheets|slides|drive|classroom|meet|zoom|pdf|dict/i.test(pkg)) return 'study';
    if (/youtube|netflix|hotstar|prime|voot|zee5|sonyliv|jio|spotify|gaana|music|game|play\.store|tiktok|moj|josh/i.test(pkg)) return 'entertainment';
    if (/whatsapp|telegram|instagram|facebook|snapchat|twitter|threads|discord|signal|messenger|hike|sharechat/i.test(pkg)) return 'social';
    if (/chrome|firefox|browser|opera|edge|safari|brave|uc\.browser/i.test(pkg)) return 'browser';
    return 'other';
}

function formatTime(iso) {
    if (!iso) return '--';
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffMin < 1440) {
        const h = Math.floor(diffMin / 60);
        return `${h}h ${diffMin % 60}m ago`;
    }

    return d.toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit'
    });
}


function formatBytes(bytes) {
    if (!bytes) return '--';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ═══════════════════════════════════════════
//  WEB ACTIVITY
// ═══════════════════════════════════════════
let webCategoryChart = null;

async function loadWebActivity() {
    try {
        const [visits, summary] = await Promise.all([
            apiFetch('/api/web-activity'),
            apiFetch('/api/web-activity/summary')
        ]);
        renderWebStats(summary);
        renderWebDomainList(summary);
        renderWebCategoryChart(summary);
        renderWebTimeline(visits);
    } catch (e) {
        console.error('Failed to load web activity:', e);
    }
}

function renderWebStats(summary) {
    const totalSites = summary.length;
    const totalSeconds = summary.reduce((sum, s) => sum + (s.total_seconds || 0), 0);
    
    document.getElementById('webTotalSites').textContent = totalSites;
    document.getElementById('webTotalTime').textContent = formatDuration(totalSeconds);
    const statWebEl = document.getElementById('statWebActivity');
    if (statWebEl) statWebEl.textContent = totalSites;
    
    // Find top category
    const catTotals = {};
    summary.forEach(s => {
        const cat = s.category || 'other';
        catTotals[cat] = (catTotals[cat] || 0) + (s.total_seconds || 0);
    });
    const topCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
    document.getElementById('webTopCategory').textContent = topCat 
        ? topCat[0].charAt(0).toUpperCase() + topCat[0].slice(1) 
        : '--';
}

function renderWebDomainList(summary) {
    const container = document.getElementById('webDomainList');
    if (!summary.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🌐</div>
                <h3>No web data yet</h3>
                <p>Website visits will appear here when browsing is detected</p>
            </div>`;
        return;
    }

    const maxSeconds = Math.max(...summary.map(s => s.total_seconds || 1));
    container.innerHTML = summary.slice(0, 15).map((site, i) => {
        const pct = Math.max(((site.total_seconds || 0) / maxSeconds) * 100, 2);
        const catColors = {
            study: '#10b981',
            entertainment: '#f59e0b',
            social: '#8b5cf6',
            shopping: '#ec4899',
            news: '#3b82f6',
            gaming: '#ef4444',
            other: '#6b7280'
        };
        const color = catColors[site.category] || catColors.other;
        const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(site.domain)}&sz=32`;
        return `
            <div class="web-domain-item">
                <span class="web-rank">${i + 1}</span>
                <img class="web-favicon" src="${favicon}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><text y=%2224%22 font-size=%2224%22>🌐</text></svg>'">
                <div class="web-domain-info">
                    <div class="web-domain-name">${escapeHtml(site.domain)}</div>
                    <div class="web-domain-bar">
                        <div class="web-domain-bar-fill" style="width:${pct}%; background:${color}"></div>
                    </div>
                </div>
                <div class="web-domain-meta">
                    <span class="web-domain-time">${formatDuration(site.total_seconds || 0)}</span>
                    <span class="web-domain-cat" style="color:${color}">${site.category || 'other'}</span>
                </div>
            </div>`;
    }).join('');
}

function renderWebCategoryChart(summary) {
    const catTotals = {};
    summary.forEach(s => {
        const cat = s.category || 'other';
        catTotals[cat] = (catTotals[cat] || 0) + (s.total_seconds || 0);
    });

    const labels = Object.keys(catTotals).map(c => c.charAt(0).toUpperCase() + c.slice(1));
    const data = Object.values(catTotals).map(s => Math.round(s / 60));
    const colors = {
        Study: '#ffffff',
        Entertainment: '#bbbbbb',
        Social: '#888888',
        Shopping: '#dddddd',
        News: '#aaaaaa',
        Gaming: '#666666',
        Other: '#444444'
    };
    const bgColors = labels.map(l => colors[l] || '#444444');

    const ctx = document.getElementById('webCategoryChart');
    if (webCategoryChart) webCategoryChart.destroy();

    if (!data.length || data.every(d => d === 0)) {
        ctx.parentElement.innerHTML = '<div class="empty-state" style="padding:2rem"><div class="empty-icon">📊</div><h3>No data</h3></div>';
        return;
    }

    webCategoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{ data, backgroundColor: bgColors, borderWidth: 0, hoverOffset: 8 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#aaaaaa', padding: 16, font: { size: 12, family: 'Inter' } }
                },
                tooltip: {
                    backgroundColor: '#080808',
                    titleColor: '#ffffff',
                    bodyColor: '#cccccc',
                    borderColor: 'rgba(255,255,255,0.15)',
                    borderWidth: 1,
                    cornerRadius: 8,
                    callbacks: {
                        label: ctx => `${ctx.label}: ${ctx.raw}m`
                    }
                }
            }
        }
    });
}

function renderWebTimeline(visits) {
    const container = document.getElementById('webTimeline');
    if (!visits.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📜</div>
                <h3>No browsing history</h3>
                <p>Recent website visits will show here in chronological order</p>
            </div>`;
        return;
    }

    const catColors = {
        study: '#10b981',
        entertainment: '#f59e0b',
        social: '#8b5cf6',
        shopping: '#ec4899',
        news: '#3b82f6',
        gaming: '#ef4444',
        other: '#6b7280'
    };

    container.innerHTML = visits.map(v => {
        const time = new Date(v.visited_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        const color = catColors[v.category] || catColors.other;
        const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(v.domain)}&sz=32`;
        const fullUrl = v.url && v.url !== v.domain ? (v.url.startsWith('http') ? v.url : `https://${v.url}`) : null;
        return `
            <div class="web-timeline-item">
                <div class="web-timeline-dot" style="background:${color}"></div>
                <div class="web-timeline-content">
                    <div class="web-timeline-header">
                        <img class="web-favicon-sm" src="${favicon}" alt="" onerror="this.style.display='none'">
                        <span class="web-timeline-domain">${escapeHtml(v.domain)}</span>
                        <span class="web-timeline-time">${time}</span>
                    </div>
                    ${fullUrl ? `<div style="margin-top:2px;font-size:0.75rem;word-break:break-all;"><a href="${escapeHtml(fullUrl)}" target="_blank" style="color:var(--accent);text-decoration:none;">🔗 ${escapeHtml(v.url)}</a></div>` : ''}
                    <div class="web-timeline-meta">
                        <span class="web-timeline-duration">${formatDuration(v.duration_seconds || 0)}</span>
                        <span class="web-timeline-cat" style="color:${color}">${v.category || 'other'}</span>
                    </div>
                </div>
            </div>`;
    }).join('');
}

function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0s';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

// ═══════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ═══════════════════════════════════════════
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
        <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s var(--ease) forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ═══════════════════════════════════════════
//  AUTO-REFRESH
// ═══════════════════════════════════════════
setInterval(() => {
    if (authToken) loadStatus();
}, 15000);

// ═══════════════════════════════════════════
//  FULL BROWSER HISTORY & EXPORT
// ═══════════════════════════════════════
let fullHistoryData = [];

async function openHistoryModal() {
    const modal = document.getElementById('historyModal');
    if (!modal) return;
    modal.classList.add('active');
    document.getElementById('historySearchInput').value = '';
    document.getElementById('historyCategoryFilter').value = '';
    await loadFullHistory();
}

function closeHistoryModal(e) {
    if (e && e.target && e.target !== e.currentTarget) return;
    const modal = document.getElementById('historyModal');
    if (modal) modal.classList.remove('active');
}

async function loadFullHistory() {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #666;">Loading browser history...</td></tr>';
    try {
        fullHistoryData = await apiFetch('/api/web-activity/history?limit=2000');
        renderHistoryTable(fullHistoryData);
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #ef4444;">Failed to load browser history</td></tr>';
        console.error('Failed to load history:', e);
    }
}

function filterHistory() {
    const q = (document.getElementById('historySearchInput')?.value || '').toLowerCase().trim();
    const cat = (document.getElementById('historyCategoryFilter')?.value || '').toLowerCase();
    const filtered = fullHistoryData.filter(v => {
        const matchQ = !q || (v.domain && v.domain.toLowerCase().includes(q)) || (v.url && v.url.toLowerCase().includes(q)) || (v.category && v.category.toLowerCase().includes(q));
        const matchCat = !cat || (v.category && v.category.toLowerCase() === cat);
        return matchQ && matchCat;
    });
    renderHistoryTable(filtered);
}

function renderHistoryTable(visits) {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    if (!visits || !visits.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #666;">No matching browser history found</td></tr>';
        return;
    }
    const catColors = {
        study: '#10b981',
        entertainment: '#f59e0b',
        social: '#8b5cf6',
        shopping: '#ec4899',
        news: '#3b82f6',
        gaming: '#ef4444',
        other: '#6b7280'
    };
    tbody.innerHTML = visits.map(v => {
        const dateStr = new Date(v.visited_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        const color = catColors[v.category] || catColors.other;
        const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(v.domain)}&sz=32`;
        const fullUrl = v.url && v.url !== v.domain ? (v.url.startsWith('http') ? v.url : `https://${v.url}`) : `https://${v.domain}`;
        return `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='transparent'">
                <td style="padding: 0.75rem 0.5rem; display:flex; align-items:center; gap:0.5rem;">
                    <img src="${favicon}" alt="" style="width:16px;height:16px;border-radius:2px;" onerror="this.style.display='none'">
                    <span style="font-weight:500; color:#fff;">${escapeHtml(v.domain)}</span>
                </td>
                <td style="padding: 0.75rem 0.5rem; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                    <a href="${escapeHtml(fullUrl)}" target="_blank" style="color:rgba(255,255,255,0.7); text-decoration:none;" title="${escapeHtml(v.url)}">${escapeHtml(v.url || v.domain)}</a>
                </td>
                <td style="padding: 0.75rem 0.5rem; color:#fff; font-weight:500;">${formatDuration(v.duration_seconds || 0)}</td>
                <td style="padding: 0.75rem 0.5rem;"><span style="color:${color}; font-weight:600; text-transform:capitalize;">${v.category || 'other'}</span></td>
                <td style="padding: 0.75rem 0.5rem; color:#888; font-size:0.8rem;">${dateStr}</td>
            </tr>`;
    }).join('');
}

function exportHistoryCsv() {
    if (!authToken) {
        showToast('Please log in first', 'error');
        return;
    }
    window.location.href = `/api/web-activity/export?token=${authToken}`;
    showToast('Exporting full browser history CSV...', 'info');
}

// ═══════════════════════════════════════════
//  PARENTAL CONTROLS & ACTIVE APP BLOCKER (PARENT-FRIENDLY)
// ═══════════════════════════════════════════

const PRESET_APPS_LIST = [
    { pkg: 'com.instagram.android', name: '📸 Instagram' },
    { pkg: 'com.google.android.youtube', name: '📺 YouTube' },
    { pkg: 'com.zhiliaoapp.musically', name: '🎵 TikTok' },
    { pkg: 'com.snapchat.android', name: '👻 Snapchat' },
    { pkg: 'com.whatsapp', name: '💬 WhatsApp' },
    { pkg: 'com.pubg.imobile', name: '🎮 BGMI / PUBG' },
    { pkg: 'com.dts.freefireth', name: '🔥 Free Fire' },
    { pkg: 'com.android.chrome', name: '🌐 Chrome Browser' },
    { pkg: 'com.roblox.client', name: '👾 Roblox' },
    { pkg: 'com.mojang.minecraftpe', name: '🕹️ Minecraft' },
    { pkg: 'com.facebook.katana', name: '📘 Facebook' },
    { pkg: 'com.twitter.android', name: '🐦 X / Twitter' },
    { pkg: 'com.discord', name: '💬 Discord' }
];

async function populateParentAppSelector(selectedPkg = '') {
    const selector = document.getElementById('ruleAppSelector');
    if (!selector) return;

    let html = `<option value="">-- Choose App from Child's Phone --</option>`;
    html += `<optgroup label="🔥 Popular Presets (Instant Select)">`;
    PRESET_APPS_LIST.forEach(a => {
        html += `<option value="${a.pkg}" data-name="${a.name.replace(/^[^\s]+\s+/, '')}">${a.name}</option>`;
    });
    html += `</optgroup>`;

    // Try fetching device apps / screen time apps dynamically
    try {
        const apps = await apiFetch('/api/apps');
        if (apps && apps.length > 0) {
            html += `<optgroup label="📱 Active / Tracked on Child's Phone">`;
            apps.forEach(a => {
                if (a.package_name && !PRESET_APPS_LIST.some(p => p.pkg === a.package_name)) {
                    html += `<option value="${a.package_name}" data-name="${escapeHtml(a.app_name || a.package_name)}">📱 ${escapeHtml(a.app_name || a.package_name)}</option>`;
                }
            });
            html += `</optgroup>`;
        }
    } catch (e) {}

    html += `<option value="custom">⚙️ Custom Package Name (Manual ID Entry)...</option>`;
    selector.innerHTML = html;

    if (selectedPkg) {
        if (selector.querySelector(`option[value="${selectedPkg}"]`)) {
            selector.value = selectedPkg;
            onAppSelectChange();
        } else {
            selector.value = 'custom';
            toggleCustomPackageInput(true);
            document.getElementById('rulePackageInput').value = selectedPkg;
        }
    } else {
        onAppSelectChange();
    }
}

function onAppSelectChange() {
    const selector = document.getElementById('ruleAppSelector');
    const displayPkg = document.getElementById('displayPackageId');
    const customDiv = document.getElementById('customPackageDiv');
    const pkgInput = document.getElementById('rulePackageInput');
    const nameInput = document.getElementById('ruleAppNameInput');
    if (!selector) return;

    const val = selector.value;
    if (val === 'custom') {
        if (displayPkg) displayPkg.textContent = 'Custom Manual Entry';
        if (customDiv) customDiv.style.display = 'block';
    } else if (val) {
        if (displayPkg) displayPkg.textContent = val;
        if (customDiv) customDiv.style.display = 'none';
        const opt = selector.options[selector.selectedIndex];
        const appName = opt ? (opt.getAttribute('data-name') || opt.text.replace(/^[^\s]+\s+/, '')) : val;
        if (pkgInput) pkgInput.value = val;
        if (nameInput) nameInput.value = appName;
    } else {
        if (displayPkg) displayPkg.textContent = 'None';
        if (customDiv) customDiv.style.display = 'none';
        if (pkgInput) pkgInput.value = '';
        if (nameInput) nameInput.value = '';
    }
}

function toggleCustomPackageInput(forceShow = null) {
    const customDiv = document.getElementById('customPackageDiv');
    const selector = document.getElementById('ruleAppSelector');
    if (!customDiv) return;
    const isShown = forceShow !== null ? forceShow : (customDiv.style.display === 'none');
    customDiv.style.display = isShown ? 'block' : 'none';
    if (isShown && selector) selector.value = 'custom';
}

function setQuickSchedule(start, end) {
    const sEl = document.getElementById('ruleScheduleStart');
    const eEl = document.getElementById('ruleScheduleEnd');
    if (sEl) sEl.value = start;
    if (eEl) eEl.value = end;
    showToast(`⏰ Study schedule set: ${start} to ${end}`, 'info');
}

function setQuickQuota(mins) {
    const qEl = document.getElementById('ruleQuotaMinutes');
    if (qEl) qEl.value = mins;
    showToast(`⏳ Daily limit set to ${mins} minutes (${Math.round(mins/60 * 10)/10} hrs)`, 'info');
}

async function applyParentPreset(presetType) {
    if (presetType === 'bedtime') {
        if (!confirm('Apply Bedtime Study Lock (9:00 PM – 6:00 AM) to Instagram, YouTube, TikTok, Snapchat & Games?')) return;
        const targetPkgs = [
            { pkg: 'com.instagram.android', name: 'Instagram' },
            { pkg: 'com.zhiliaoapp.musically', name: 'TikTok' },
            { pkg: 'com.google.android.youtube', name: 'YouTube' },
            { pkg: 'com.pubg.imobile', name: 'BGMI / PUBG' },
            { pkg: 'com.dts.freefireth', name: 'Free Fire' }
        ];
        let saved = 0;
        for (const item of targetPkgs) {
            try {
                await apiFetch('/api/blocked-apps', {
                    method: 'POST',
                    body: JSON.stringify({
                        package_name: item.pkg,
                        app_name: item.name,
                        is_blocked: true,
                        schedule_start: '21:00',
                        schedule_end: '06:00',
                        daily_quota_minutes: 0
                    })
                });
                saved++;
            } catch (e) {}
        }
        showToast(`🌙 Bedtime Study Lock activated across ${saved} social/gaming apps!`, 'success');
        loadBlockedApps();
    } else if (presetType === 'lockall') {
        if (!confirm('Immediately lock all major social media and gaming apps right now?')) return;
        const targetPkgs = [
            { pkg: 'com.instagram.android', name: 'Instagram' },
            { pkg: 'com.zhiliaoapp.musically', name: 'TikTok' },
            { pkg: 'com.google.android.youtube', name: 'YouTube' },
            { pkg: 'com.snapchat.android', name: 'Snapchat' },
            { pkg: 'com.pubg.imobile', name: 'BGMI / PUBG' },
            { pkg: 'com.dts.freefireth', name: 'Free Fire' }
        ];
        let saved = 0;
        for (const item of targetPkgs) {
            try {
                await apiFetch('/api/blocked-apps', {
                    method: 'POST',
                    body: JSON.stringify({
                        package_name: item.pkg,
                        app_name: item.name,
                        is_blocked: true,
                        schedule_start: null,
                        schedule_end: null,
                        daily_quota_minutes: 0
                    })
                });
                saved++;
            } catch (e) {}
        }
        showToast(`🔒 Instant Focus Lock activated across ${saved} apps!`, 'success');
        loadBlockedApps();
    } else if (presetType === 'quota1hr') {
        if (!confirm('Set a 1-Hour (60 min) Daily Screen Limit across top social media & gaming apps?')) return;
        const targetPkgs = [
            { pkg: 'com.instagram.android', name: 'Instagram' },
            { pkg: 'com.zhiliaoapp.musically', name: 'TikTok' },
            { pkg: 'com.google.android.youtube', name: 'YouTube' },
            { pkg: 'com.pubg.imobile', name: 'BGMI / PUBG' },
            { pkg: 'com.dts.freefireth', name: 'Free Fire' }
        ];
        let saved = 0;
        for (const item of targetPkgs) {
            try {
                await apiFetch('/api/blocked-apps', {
                    method: 'POST',
                    body: JSON.stringify({
                        package_name: item.pkg,
                        app_name: item.name,
                        is_blocked: true,
                        schedule_start: null,
                        schedule_end: null,
                        daily_quota_minutes: 60
                    })
                });
                saved++;
            } catch (e) {}
        }
        showToast(`⏳ 1-Hour Daily Limit applied across ${saved} apps!`, 'success');
        loadBlockedApps();
    } else if (presetType === 'unlockall') {
        if (!confirm('Are you sure you want to remove ALL restrictions for weekend / holiday free access?')) return;
        try {
            const current = await apiFetch('/api/blocked-apps');
            if (current && current.length > 0) {
                for (const app of current) {
                    await apiFetch(`/api/blocked-apps/${encodeURIComponent(app.package_name)}`, { method: 'DELETE' });
                }
            }
            showToast('🔓 All active restrictions cleared successfully!', 'success');
            loadBlockedApps();
        } catch (e) {
            showToast('Failed to clear some restrictions', 'error');
        }
    }
}

function openAddRuleModal(packageName = '', appName = '') {
    const modal = document.getElementById('addRuleModal');
    if (!modal) return;
    document.getElementById('ruleTypeSelect').value = 'always';
    toggleRuleInputs();
    populateParentAppSelector(packageName);
    if (appName && document.getElementById('ruleAppNameInput')) {
        document.getElementById('ruleAppNameInput').value = appName;
    }
    modal.classList.add('active');
}

function closeAddRuleModal(event) {
    if (event && event.target !== event.currentTarget && !event.target.classList.contains('modal-close')) return;
    const modal = document.getElementById('addRuleModal');
    if (modal) modal.classList.remove('active');
}

function toggleRuleInputs() {
    const type = document.getElementById('ruleTypeSelect').value;
    const scheduleDiv = document.getElementById('scheduleInputs');
    const quotaDiv = document.getElementById('quotaInputs');
    if (scheduleDiv) scheduleDiv.style.display = type === 'schedule' ? 'flex' : 'none';
    if (quotaDiv) quotaDiv.style.display = type === 'quota' ? 'block' : 'none';
}

async function saveBlockRule(event) {
    event.preventDefault();
    let pkg = document.getElementById('rulePackageInput').value.trim();
    let name = document.getElementById('ruleAppNameInput').value.trim();
    const selector = document.getElementById('ruleAppSelector');
    if (selector && selector.value && selector.value !== 'custom') {
        pkg = selector.value;
        const opt = selector.options[selector.selectedIndex];
        name = opt ? (opt.getAttribute('data-name') || opt.text.replace(/^[^\s]+\s+/, '')) : pkg;
    }
    if (!pkg) {
        showToast('Please select an app to restrict or enter a valid package ID', 'error');
        return;
    }
    const type = document.getElementById('ruleTypeSelect').value;

    let scheduleStart = null;
    let scheduleEnd = null;
    let quotaMinutes = 0;

    if (type === 'schedule') {
        scheduleStart = document.getElementById('ruleScheduleStart').value;
        scheduleEnd = document.getElementById('ruleScheduleEnd').value;
        if (!scheduleStart || !scheduleEnd) {
            showToast('Please specify both start and end times for the study schedule', 'error');
            return;
        }
    } else if (type === 'quota') {
        quotaMinutes = parseInt(document.getElementById('ruleQuotaMinutes').value, 10) || 0;
        if (quotaMinutes <= 0) {
            showToast('Please enter a valid daily usage quota in minutes', 'error');
            return;
        }
    }

    try {
        const res = await apiFetch('/api/blocked-apps', {
            method: 'POST',
            body: JSON.stringify({
                package_name: pkg,
                app_name: name,
                is_blocked: true,
                schedule_start: scheduleStart,
                schedule_end: scheduleEnd,
                daily_quota_minutes: quotaMinutes
            })
        });
        if (res && res.success) {
            showToast(`Rule saved for ${name}! Pushed to device offline cache.`, 'success');
            closeAddRuleModal();
            loadBlockedApps();
        } else {
            showToast(res.error || 'Failed to save rule', 'error');
        }
    } catch (e) {
        showToast('Error saving block rule', 'error');
    }
}

async function deleteBlockRule(packageName) {
    if (!confirm(`Are you sure you want to remove all restrictions for ${packageName}?`)) return;
    try {
        const res = await apiFetch(`/api/blocked-apps/${encodeURIComponent(packageName)}`, { method: 'DELETE' });
        if (res && res.success) {
            showToast('Rule deleted successfully', 'success');
            loadBlockedApps();
        } else {
            showToast(res.error || 'Failed to delete rule', 'error');
        }
    } catch (e) {
        showToast('Error deleting rule', 'error');
    }
}

async function toggleBlockRule(packageName, currentBlocked, appName, scheduleStart, scheduleEnd, quotaMinutes) {
    try {
        const res = await apiFetch('/api/blocked-apps', {
            method: 'POST',
            body: JSON.stringify({
                package_name: packageName,
                app_name: appName,
                is_blocked: !currentBlocked,
                schedule_start: scheduleStart || null,
                schedule_end: scheduleEnd || null,
                daily_quota_minutes: quotaMinutes || 0
            })
        });
        if (res && res.success) {
            showToast(`Updated restriction status for ${appName}`, 'success');
            loadBlockedApps();
        } else {
            showToast(res.error || 'Failed to toggle rule', 'error');
        }
    } catch (e) {
        showToast('Error toggling block rule', 'error');
    }
}

async function loadBlockedApps() {
    const tbody = document.getElementById('blockedAppsTableBody');
    if (!tbody) return;
    try {
        const rules = await apiFetch('/api/blocked-apps');
        if (!rules || !rules.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2.5rem; color: var(--text-secondary);">No restriction rules active. Click "➕ Add New Block Rule" to configure parental controls.</td></tr>`;
            return;
        }

        tbody.innerHTML = rules.map(r => {
            const isBlocked = r.is_blocked === 1 || r.is_blocked === true;
            let typeBadge = `<span style="background:rgba(255,107,107,0.15); color:#ff6b6b; padding:0.25rem 0.6rem; border-radius:12px; font-size:0.75rem; font-weight:600;">🛑 Always Block</span>`;
            let details = 'Instant lockout 24/7';

            if (r.schedule_start && r.schedule_end) {
                typeBadge = `<span style="background:rgba(245,158,11,0.15); color:#f59e0b; padding:0.25rem 0.6rem; border-radius:12px; font-size:0.75rem; font-weight:600;">📅 Study Schedule</span>`;
                details = `Blocked from <b>${escapeHtml(r.schedule_start)}</b> to <b>${escapeHtml(r.schedule_end)}</b>`;
            } else if (r.daily_quota_minutes > 0) {
                typeBadge = `<span style="background:rgba(59,130,246,0.15); color:#60a5fa; padding:0.25rem 0.6rem; border-radius:12px; font-size:0.75rem; font-weight:600;">⏳ Daily Quota</span>`;
                details = `Block after <b>${r.daily_quota_minutes} minutes</b> / day`;
            }

            const statusHtml = isBlocked
                ? `<span style="color:#10b981; font-weight:600; display:flex; align-items:center; gap:0.35rem;">🟢 Active</span>`
                : `<span style="color:#6b7280; font-weight:600; display:flex; align-items:center; gap:0.35rem;">⚪ Paused</span>`;

            return `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 0.85rem 0.75rem; font-weight:600; color:#fff;">${escapeHtml(r.app_name)}</td>
                    <td style="padding: 0.85rem 0.75rem; color:var(--text-secondary); font-family:monospace; font-size:0.85rem;">${escapeHtml(r.package_name)}</td>
                    <td style="padding: 0.85rem 0.75rem;">${typeBadge}</td>
                    <td style="padding: 0.85rem 0.75rem; color:#e5e7eb; font-size:0.9rem;">${details}</td>
                    <td style="padding: 0.85rem 0.75rem;">${statusHtml}</td>
                    <td style="padding: 0.85rem 0.75rem;">
                        <div style="display:flex; gap:0.5rem;">
                            <button class="btn btn-sm" onclick="toggleBlockRule('${escapeHtml(r.package_name)}', ${isBlocked}, '${escapeHtml(r.app_name)}', '${escapeHtml(r.schedule_start || '')}', '${escapeHtml(r.schedule_end || '')}', ${r.daily_quota_minutes || 0})" style="background:rgba(255,255,255,0.08); border:1px solid var(--border); color:#fff; padding:0.3rem 0.65rem;" title="${isBlocked ? 'Pause restriction' : 'Resume restriction'}">${isBlocked ? '⏸️ Pause' : '▶️ Resume'}</button>
                            <button class="btn btn-sm" onclick="deleteBlockRule('${escapeHtml(r.package_name)}')" style="background:rgba(255,107,107,0.15); border:1px solid rgba(255,107,107,0.3); color:#ff6b6b; padding:0.3rem 0.65rem;" title="Delete rule">🗑️ Delete</button>
                        </div>
                    </td>
                </tr>`;
        }).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: #ff6b6b;">Error loading restriction rules: ${e.message}</td></tr>`;
    }
}

let cachedTotalAppsList = [];
async function loadTotalAppsList() {
    const tbody = document.getElementById('totalAppsTableBody');
    if (!tbody) return;
    try {
        const [apps, rules] = await Promise.all([
            apiFetch('/api/apps'),
            apiFetch('/api/blocked-apps')
        ]);

        const rulesMap = {};
        if (rules && Array.isArray(rules)) {
            rules.forEach(r => {
                rulesMap[r.package_name] = r;
            });
        }

        const appMap = new Map();
        // First add popular presets so parents see them right away even if device hasn't reported yet
        PRESET_APPS_LIST.forEach(p => {
            appMap.set(p.pkg, { package_name: p.pkg, app_name: p.name.replace(/^[^\s]+\s+/, '') });
        });

        // Add dynamically reported running/tracked apps from device
        if (apps && Array.isArray(apps)) {
            apps.forEach(a => {
                if (a.package_name && !a.package_name.startsWith('com.android.systemui') && !a.package_name.startsWith('android')) {
                    appMap.set(a.package_name, {
                        package_name: a.package_name,
                        app_name: a.app_name || a.package_name
                    });
                }
            });
        }

        // Add any apps that already have rules
        if (rules && Array.isArray(rules)) {
            rules.forEach(r => {
                if (r.package_name && !appMap.has(r.package_name)) {
                    appMap.set(r.package_name, { package_name: r.package_name, app_name: r.app_name });
                }
            });
        }

        cachedTotalAppsList = Array.from(appMap.values()).map(app => {
            const rule = rulesMap[app.package_name];
            return {
                ...app,
                rule: rule || null
            };
        }).sort((a, b) => (a.app_name || '').localeCompare(b.app_name || ''));

        renderTotalAppsList(cachedTotalAppsList);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 2rem; color: #ff6b6b;">Error loading total app list: ${escapeHtml(e.message)}</td></tr>`;
    }
}

function filterTotalAppsList() {
    const query = (document.getElementById('totalAppsSearchInput')?.value || '').toLowerCase().trim();
    if (!query) {
        renderTotalAppsList(cachedTotalAppsList);
        return;
    }
    const filtered = cachedTotalAppsList.filter(a =>
        (a.app_name || '').toLowerCase().includes(query) ||
        (a.package_name || '').toLowerCase().includes(query)
    );
    renderTotalAppsList(filtered);
}

function renderTotalAppsList(list) {
    const tbody = document.getElementById('totalAppsTableBody');
    if (!tbody) return;
    if (!list || !list.length) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 2.5rem; color: var(--text-secondary);">No apps found matching your search.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(item => {
        const r = item.rule;
        const isBlocked = r && (r.is_blocked === 1 || r.is_blocked === true);
        let statusBadge = `<span style="background:rgba(255,255,255,0.06); color:#aaa; padding:0.25rem 0.6rem; border-radius:12px; font-size:0.75rem; font-weight:600;">🟢 Unrestricted</span>`;
        if (isBlocked) {
            if (r.schedule_start && r.schedule_end) {
                statusBadge = `<span style="background:rgba(245,158,11,0.18); color:#f59e0b; padding:0.25rem 0.6rem; border-radius:12px; font-size:0.75rem; font-weight:700;">📅 Study (${escapeHtml(r.schedule_start)}-${escapeHtml(r.schedule_end)})</span>`;
            } else if (r.daily_quota_minutes > 0) {
                statusBadge = `<span style="background:rgba(59,130,246,0.18); color:#60a5fa; padding:0.25rem 0.6rem; border-radius:12px; font-size:0.75rem; font-weight:700;">⏳ ${r.daily_quota_minutes}m limit/day</span>`;
            } else {
                statusBadge = `<span style="background:rgba(255,107,107,0.18); color:#ff6b6b; padding:0.25rem 0.6rem; border-radius:12px; font-size:0.75rem; font-weight:700;">🛑 Always Blocked</span>`;
            }
        }

        return `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='transparent'">
                <td style="padding: 0.8rem 0.75rem; font-weight:600; color:#fff;">${escapeHtml(item.app_name)}</td>
                <td style="padding: 0.8rem 0.75rem; color:var(--text-secondary); font-family:monospace; font-size:0.82rem;">${escapeHtml(item.package_name)}</td>
                <td style="padding: 0.8rem 0.75rem;">${statusBadge}</td>
                <td style="padding: 0.8rem 0.75rem;">
                    <div style="display:flex; flex-wrap:wrap; gap:0.4rem; align-items:center;">
                        <button type="button" class="btn btn-sm" onclick="quickSetTimeLimit('${escapeHtml(item.package_name)}', '${escapeHtml(item.app_name)}', 15)" style="background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.35); color:#93c5fd; font-size:0.76rem; padding:0.25rem 0.55rem;">⏳ 15m</button>
                        <button type="button" class="btn btn-sm" onclick="quickSetTimeLimit('${escapeHtml(item.package_name)}', '${escapeHtml(item.app_name)}', 30)" style="background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.35); color:#93c5fd; font-size:0.76rem; padding:0.25rem 0.55rem;">⏳ 30m</button>
                        <button type="button" class="btn btn-sm" onclick="quickSetTimeLimit('${escapeHtml(item.package_name)}', '${escapeHtml(item.app_name)}', 60)" style="background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.35); color:#93c5fd; font-size:0.76rem; padding:0.25rem 0.55rem;">⏳ 1h</button>
                        <button type="button" class="btn btn-sm" onclick="quickSetTimeLimit('${escapeHtml(item.package_name)}', '${escapeHtml(item.app_name)}', 0, true)" style="background:rgba(255,107,107,0.15); border:1px solid rgba(255,107,107,0.35); color:#ff8787; font-size:0.76rem; padding:0.25rem 0.55rem;">🛑 Block</button>
                        ${isBlocked ? `<button type="button" class="btn btn-sm" onclick="deleteBlockRule('${escapeHtml(item.package_name)}'); setTimeout(loadTotalAppsList, 300);" style="background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.35); color:#6ee7b7; font-size:0.76rem; padding:0.25rem 0.55rem;">🟢 Remove Limit</button>` : ''}
                        <button type="button" class="btn btn-sm" onclick="openAddRuleModal('${escapeHtml(item.package_name)}', '${escapeHtml(item.app_name)}')" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.18); color:#ddd; font-size:0.76rem; padding:0.25rem 0.55rem;">⚙️ Custom</button>
                    </div>
                </td>
            </tr>`;
    }).join('');
}

async function quickSetTimeLimit(pkg, name, minutes, isAlwaysBlock = false) {
    try {
        const res = await apiFetch('/api/blocked-apps', {
            method: 'POST',
            body: JSON.stringify({
                package_name: pkg,
                app_name: name,
                is_blocked: true,
                schedule_start: null,
                schedule_end: null,
                daily_quota_minutes: isAlwaysBlock ? 0 : minutes
            })
        });
        if (res && res.success) {
            const desc = isAlwaysBlock ? 'always blocked' : `set to ${minutes}m daily limit`;
            showToast(`✅ ${name} is now ${desc}! Synced to child's phone.`, 'success');
            loadTotalAppsList();
            loadBlockedApps();
        } else {
            showToast(res.error || 'Failed to set time limit', 'error');
        }
    } catch (e) {
        showToast('Error setting time limit', 'error');
    }
}

async function loadBlockedAttempts() {
    const tbody = document.getElementById('blockedAttemptsTableBody');
    if (!tbody) return;
    try {
        const attempts = await apiFetch('/api/blocked-attempts');
        if (!attempts || !attempts.length) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 2.5rem; color: var(--text-secondary);">No app block interceptions recorded yet. When the user tries to open a restricted app on the device, it will be blocked within 50ms and logged here instantly.</td></tr>`;
            return;
        }

        tbody.innerHTML = attempts.map(a => {
            const timeStr = new Date(a.attempted_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 0.85rem 0.75rem; color:#888; font-size:0.85rem;">${timeStr}</td>
                    <td style="padding: 0.85rem 0.75rem; font-weight:600; color:#fff;">${escapeHtml(a.app_name)}</td>
                    <td style="padding: 0.85rem 0.75rem; color:var(--text-secondary); font-family:monospace; font-size:0.85rem;">${escapeHtml(a.package_name)}</td>
                    <td style="padding: 0.85rem 0.75rem;">
                        <span style="background:rgba(255,107,107,0.15); color:#ff6b6b; padding:0.25rem 0.65rem; border-radius:12px; font-size:0.8rem; font-weight:600;">🛑 ${escapeHtml(a.reason)}</span>
                    </td>
                </tr>`;
        }).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 2rem; color: #ff6b6b;">Error loading interception logs: ${e.message}</td></tr>`;
    }
}

// ═══════════════════════════════════════════
//  DAILY REPORT & CSV EXPORT FUNCTIONS
// ═══════════════════════════════════════════
let currentDailyReportDate = '';

async function openDailyReportModal(dateStr = '') {
    const modal = document.getElementById('dailyReportModal');
    if (!modal) return;
    modal.style.display = 'flex';

    if (!dateStr) {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        dateStr = `${year}-${month}-${day}`;
    }
    currentDailyReportDate = dateStr;

    document.getElementById('dailyReportDateText').innerText = `Generating daily productivity, screen time, and parental interception report for ${dateStr}...`;
    document.getElementById('dailyReportStatsGrid').innerHTML = `<div style="color:#94a3b8; padding:1rem;">⏳ Processing analytics data...</div>`;

    try {
        const data = await apiFetch(`/api/reports/daily?date=${dateStr}`);
        if (!data || data.error) throw new Error(data.error || 'Failed to load report');

        const sum = data.summary || {};
        const totalMins = Math.round(sum.totalSeconds / 60);
        const studyMins = Math.round(sum.studySeconds / 60);
        const entertainMins = Math.round(sum.entertainmentSeconds / 60);

        document.getElementById('dailyReportDateText').innerHTML = `Completed analysis for <strong>${dateStr}</strong> &bull; Total screen activity: <strong>${formatDuration(sum.totalSeconds)}</strong>`;

        document.getElementById('dailyReportStatsGrid').innerHTML = `
            <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:1rem; text-align:center;">
                <div style="font-size:1.5rem; font-weight:bold; color:#60a5fa;">${formatDuration(sum.totalSeconds)}</div>
                <div style="font-size:0.75rem; color:#94a3b8; margin-top:0.2rem;">TOTAL SCREEN TIME</div>
            </div>
            <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:1rem; text-align:center;">
                <div style="font-size:1.5rem; font-weight:bold; color:#34d399;">${formatDuration(sum.studySeconds)}</div>
                <div style="font-size:0.75rem; color:#94a3b8; margin-top:0.2rem;">📚 STUDY & PRODUCTIVITY</div>
            </div>
            <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:1rem; text-align:center;">
                <div style="font-size:1.5rem; font-weight:bold; color:#f87171;">${formatDuration(sum.entertainmentSeconds)}</div>
                <div style="font-size:0.75rem; color:#94a3b8; margin-top:0.2rem;">🎮 GAMES & SOCIAL MEDIA</div>
            </div>
            <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:1rem; text-align:center;">
                <div style="font-size:1.5rem; font-weight:bold; color:#fbbf24;">${sum.blockedAttemptsCount}</div>
                <div style="font-size:0.75rem; color:#94a3b8; margin-top:0.2rem;">🛑 APP BLOCKS / INTERCEPTS</div>
            </div>
            <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:1rem; text-align:center;">
                <div style="font-size:1.5rem; font-weight:bold; color:#a78bfa;">${sum.autoScreenshotsCount} / ${sum.screenshotsCount}</div>
                <div style="font-size:0.75rem; color:#94a3b8; margin-top:0.2rem;">⚡ AUTO vs TOTAL SCREENSHOTS</div>
            </div>
        `;

        // Ratio bar
        const totalRated = (sum.studySeconds + sum.entertainmentSeconds) || 1;
        const studyPct = Math.round((sum.studySeconds / totalRated) * 100);
        const entertainPct = 100 - studyPct;

        document.getElementById('dailyProductivityScoreText').innerText = sum.totalSeconds ? `${studyPct}% Productivity Ratio` : 'No activity recorded';
        document.getElementById('dailyStudyTimeLabel').innerText = `📚 Study / Educational: ${formatDuration(sum.studySeconds)}`;
        document.getElementById('dailyEntertainTimeLabel').innerText = `🎮 Games / Social / Entertainment: ${formatDuration(sum.entertainmentSeconds)}`;
        document.getElementById('dailyTotalTimeLabel').innerText = `⏱️ Total Screen Time: ${formatDuration(sum.totalSeconds)}`;

        document.getElementById('dailyProductivityBar').innerHTML = `
            <div style="height:100%; width:${studyPct}%; background:linear-gradient(90deg, #3b82f6, #10b981); transition:width 0.5s;"></div>
            <div style="height:100%; width:${entertainPct}%; background:linear-gradient(90deg, #f59e0b, #ef4444); transition:width 0.5s;"></div>
        `;

        // Top apps
        const topApps = (data.screenTime || []).slice(0, 7);
        document.getElementById('dailyTopAppsList').innerHTML = topApps.length ? topApps.map(a => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0.5rem; background:rgba(255,255,255,0.02); border-radius:6px; font-size:0.85rem;">
                <div>
                    <strong style="color:#fff;">${escapeHtml(a.app_name || a.package_name)}</strong>
                    <span style="color:#64748b; font-size:0.75rem; display:block;">${escapeHtml(a.package_name || '')}</span>
                </div>
                <span style="color:#60a5fa; font-weight:bold;">${formatDuration(a.seconds || 0)}</span>
            </div>
        `).join('') : `<div style="color:#64748b; font-size:0.85rem;">No app usage recorded today.</div>`;

        // Web & Block intercepts
        const topWeb = (data.webActivity || []).slice(0, 5);
        const topBlocks = (data.blockedAttempts || []).slice(0, 3);
        let rightList = '';
        if (topBlocks.length) {
            rightList += topBlocks.map(b => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0.5rem; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); border-radius:6px; font-size:0.85rem;">
                    <div>
                        <strong style="color:#f87171;">🛑 Intercepted: ${escapeHtml(b.app_name)}</strong>
                        <span style="color:#94a3b8; font-size:0.75rem; display:block;">Reason: ${escapeHtml(b.reason)}</span>
                    </div>
                    <span style="color:#f87171; font-size:0.75rem;">${new Date(b.attempted_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                </div>
            `).join('');
        }
        if (topWeb.length) {
            rightList += topWeb.map(w => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0.5rem; background:rgba(255,255,255,0.02); border-radius:6px; font-size:0.85rem;">
                    <div style="overflow:hidden;">
                        <strong style="color:#fff; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">🌐 ${escapeHtml(w.domain || w.url)}</strong>
                    </div>
                    <span style="color:#a78bfa; font-weight:bold; flex-shrink:0;">${formatDuration(w.duration_seconds || 0)}</span>
                </div>
            `).join('');
        }
        document.getElementById('dailyWebAndBlockList').innerHTML = rightList || `<div style="color:#64748b; font-size:0.85rem;">No web browsing or interception logs recorded today.</div>`;

    } catch (e) {
        document.getElementById('dailyReportStatsGrid').innerHTML = `<div style="color:#f87171; padding:1rem; grid-column:1/-1;">Error loading report data: ${e.message}</div>`;
    }
}

function closeDailyReportModal() {
    const modal = document.getElementById('dailyReportModal');
    if (modal) modal.style.display = 'none';
}

function downloadDailyCSV() {
    const dateStr = currentDailyReportDate || new Date().toISOString().split('T')[0];
    window.location.href = `/api/reports/csv?date=${dateStr}&token=${authToken}`;
}

function toggleAutoScreenshots(enabled) {
    showToast(`Automated random stealth screenshots ${enabled ? 'ENABLED (every ~15 mins)' : 'DISABLED'}`);
}




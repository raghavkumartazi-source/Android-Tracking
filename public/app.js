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
        case 'command_result':
            if (msg.success) {
                showToast('Command executed', 'success');
            } else {
                showToast('Command failed', 'error');
            }
            break;
        case 'web_activity':
            // Real-time: if on web page, refresh data
            if (document.getElementById('webPage')?.classList.contains('active')) {
                loadWebActivity();
            }
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
        web: 'Web Activity'
    };
    document.getElementById('headerTitle').textContent = titles[page] || page;

    // Load data for the page
    if (page === 'screenshots') loadScreenshots();
    if (page === 'activity') loadActivities();
    if (page === 'screentime') loadScreenTime();
    if (page === 'apps') loadApps();
    if (page === 'web') loadWebActivity();
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
    loadActivities();
    loadScreenTime();
    loadApps();
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
        const screenshots = await apiFetch('/api/screenshots?limit=30');
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
            <div class="screenshot-thumb">
                <img src="/api/screenshots/file/${s.filename}?token=${authToken}" alt="Screenshot" loading="lazy">
            </div>
            <div class="screenshot-meta">
                <span class="screenshot-time">${formatTime(s.captured_at)}</span>
                <span class="screenshot-size">${formatBytes(s.file_size)}</span>
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
                    <div class="screenshot-thumb" style="aspect-ratio:16/10">
                        <img src="/api/screenshots/file/${s.filename}?token=${authToken}" alt="Screenshot" loading="lazy" style="width:100%;height:100%;object-fit:cover">
                    </div>
                    <div style="padding:8px 10px">
                        <span class="screenshot-time" style="font-size:0.6875rem">${formatTime(s.captured_at)}</span>
                    </div>
                </div>
            `).join('')}
        </div>`;
}

function openScreenshot(filename, time) {
    const modal = document.getElementById('screenshotModal');
    const img = document.getElementById('modalImage');
    const title = document.getElementById('modalTitle');

    img.src = `/api/screenshots/file/${filename}?token=${authToken}`;
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
async function loadScreenTime() {
    try {
        const data = await apiFetch('/api/screentime');
        renderWeeklyChart(data.daily);
        renderCategoryChart(data.categories);
        renderCategoryList(data.categories);
        renderTopApps(data.apps);

        // Update stat
        const todayTotal = data.daily.find(d => d.date === new Date().toISOString().split('T')[0]);
        if (todayTotal) {
            document.getElementById('statScreenTime').textContent = formatDuration(todayTotal.total_seconds);

            const studyTime = data.categories.find(c => c.category === 'study');
            if (studyTime) {
                document.getElementById('statScreenTimeSub').textContent = `Study: ${formatDuration(studyTime.total_seconds)}`;
            }
        }
    } catch {}
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
                <span class="app-card-badge ${a.is_foreground ? 'fg' : 'bg'}">${a.is_foreground ? 'FG' : 'BG'}</span>
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

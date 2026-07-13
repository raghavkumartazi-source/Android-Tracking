require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { initDB } = require('./db');

// ═══════════════════════════════════════════
//  Initialize
// ═══════════════════════════════════════════
const db = initDB();
const app = express();
const server = http.createServer(app);

const agentWss = new WebSocketServer({ noServer: true });
const dashboardWss = new WebSocketServer({ noServer: true });

// Config
const PORT = process.env.PORT || 3000;
const PIN = process.env.DASHBOARD_PIN || '1234';
const AGENT_KEY = process.env.AGENT_KEY || 'bharatwatch-agent-secret-change-me';

// Ensure screenshots directory
const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || path.join(__dirname, 'data', 'screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// Session store (in-memory)
const sessions = new Map();

// Agent & dashboard connections
let agentSocket = null;
const dashboardSockets = new Set();

// ═══════════════════════════════════════════
//  Middleware
// ═══════════════════════════════════════════
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware
function requireAuth(req, res, next) {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const session = sessions.get(token);
    // 24-hour session expiry
    if (Date.now() - session.created > 24 * 60 * 60 * 1000) {
        sessions.delete(token);
        return res.status(401).json({ error: 'Session expired' });
    }
    next();
}

// ═══════════════════════════════════════════
//  Helper: Broadcast to dashboards
// ═══════════════════════════════════════════
function broadcastToDashboard(data) {
    const msg = JSON.stringify(data);
    dashboardSockets.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
}

function isAgentOnline() {
    return agentSocket && agentSocket.readyState === WebSocket.OPEN;
}

// ═══════════════════════════════════════════
//  App Categorization
// ═══════════════════════════════════════════
function categorizeApp(packageName) {
    if (!packageName) return 'other';
    const pkg = packageName.toLowerCase();

    if (/edu|learn|study|school|book|read|course|class|math|science|khan|byju|unacademy|toppr|vedantu|doubtnut|brainly|quizlet|notion|evernote|onenote|google\.docs|sheets|slides|drive|classroom|meet|zoom|pdf|dict/i.test(pkg)) {
        return 'study';
    }
    if (/youtube|netflix|hotstar|prime|voot|zee5|sonyliv|jio|spotify|gaana|music|game|play\.store|tiktok|moj|josh/i.test(pkg)) {
        return 'entertainment';
    }
    if (/whatsapp|telegram|instagram|facebook|snapchat|twitter|threads|discord|signal|messenger|hike|sharechat/i.test(pkg)) {
        return 'social';
    }
    if (/chrome|firefox|browser|opera|edge|safari|brave|uc\.browser/i.test(pkg)) {
        return 'browser';
    }
    return 'other';
}

function categorizeWebDomain(domain) {
    if (!domain) return 'other';
    const d = domain.toLowerCase();

    // Study / Educational
    if (/khanacademy|coursera|udemy|edx|brilliant|duolingo|quizlet|brainly|byjus|unacademy|vedantu|toppr|doubtnut|wikipedia|wikimedia|scholar\.google|docs\.google|drive\.google|classroom\.google|notion\.so|evernote|onenote|stackoverflow|github|geeksforgeeks|w3schools|codecademy|freecodecamp|hackerrank|leetcode|studocu|academia\.edu|jstor|researchgate|springer|sciencedirect|mathway|wolframalpha|chegg|bartleby/.test(d)) {
        return 'study';
    }
    // Entertainment
    if (/youtube|netflix|hotstar|primevideo|amazon\..*\/video|voot|zee5|sonyliv|jiocinema|spotify|gaana|jiosaavn|soundcloud|twitch|crunchyroll|9anime|kissanime|mangadex|fmovies|123movies|putlocker|pornhub|xvideos|xnxx|xhamster|redtube/.test(d)) {
        return 'entertainment';
    }
    // Social Media
    if (/facebook|instagram|twitter|x\.com|threads\.net|snapchat|whatsapp|telegram|discord|reddit|tumblr|pinterest|linkedin|tiktok|sharechat|quora|medium\.com/.test(d)) {
        return 'social';
    }
    // Shopping
    if (/amazon\.|flipkart|myntra|meesho|ajio|snapdeal|ebay|aliexpress|shopify/.test(d)) {
        return 'shopping';
    }
    // News
    if (/news|ndtv|aajtak|zeenews|indiatoday|thehindu|indianexpress|hindustantimes|bbc|cnn|reuters|aljazeera/.test(d)) {
        return 'news';
    }
    // Gaming
    if (/game|roblox|miniclip|poki|crazygames|itch\.io|steam|epicgames/.test(d)) {
        return 'gaming';
    }
    return 'other';
}

// ═══════════════════════════════════════════
//  AUTH ENDPOINTS
// ═══════════════════════════════════════════
app.post('/api/login', (req, res) => {
    const { pin } = req.body;
    if (pin === PIN) {
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, { created: Date.now() });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ error: 'Invalid PIN' });
    }
});

app.post('/api/logout', requireAuth, (req, res) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (token) sessions.delete(token);
    res.json({ success: true });
});

app.get('/api/verify', requireAuth, (req, res) => {
    res.json({ valid: true });
});

// ═══════════════════════════════════════════
//  STATUS
// ═══════════════════════════════════════════
app.get('/api/status', requireAuth, (req, res) => {
    const status = db.prepare('SELECT * FROM device_status WHERE id = 1').get();
    res.json({ ...status, is_online: isAgentOnline() ? 1 : 0 });
});

// ═══════════════════════════════════════════
//  COMMANDS (screenshot, lock, unlock)
// ═══════════════════════════════════════════
app.post('/api/screenshot', requireAuth, (req, res) => {
    if (!isAgentOnline()) {
        return res.status(503).json({ error: 'Device is offline' });
    }
    const commandId = crypto.randomUUID();
    agentSocket.send(JSON.stringify({ type: 'command', command: 'screenshot', id: commandId }));
    db.prepare('INSERT INTO commands (id, type, status, created_at) VALUES (?, ?, ?, ?)')
        .run(commandId, 'screenshot', 'pending', new Date().toISOString());
    res.json({ success: true, commandId });
});

app.post('/api/lock', requireAuth, (req, res) => {
    if (!isAgentOnline()) {
        return res.status(503).json({ error: 'Device is offline' });
    }
    const commandId = crypto.randomUUID();
    agentSocket.send(JSON.stringify({ type: 'command', command: 'lock', id: commandId }));
    db.prepare('INSERT INTO commands (id, type, status, created_at) VALUES (?, ?, ?, ?)')
        .run(commandId, 'lock', 'pending', new Date().toISOString());
    db.prepare('UPDATE device_status SET is_locked = 1, updated_at = ? WHERE id = 1')
        .run(new Date().toISOString());
    broadcastToDashboard({ type: 'device_locked' });
    res.json({ success: true, commandId });
});

app.post('/api/unlock', requireAuth, (req, res) => {
    if (!isAgentOnline()) {
        return res.status(503).json({ error: 'Device is offline' });
    }
    const commandId = crypto.randomUUID();
    agentSocket.send(JSON.stringify({ type: 'command', command: 'unlock', id: commandId }));
    db.prepare('INSERT INTO commands (id, type, status, created_at) VALUES (?, ?, ?, ?)')
        .run(commandId, 'unlock', 'pending', new Date().toISOString());
    db.prepare('UPDATE device_status SET is_locked = 0, updated_at = ? WHERE id = 1')
        .run(new Date().toISOString());
    broadcastToDashboard({ type: 'device_unlocked' });
    res.json({ success: true, commandId });
});

// ═══════════════════════════════════════════
//  ACTIVITIES
// ═══════════════════════════════════════════
app.get('/api/activities', requireAuth, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const activities = db.prepare(
        'SELECT * FROM activities ORDER BY started_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset);
    const total = db.prepare('SELECT COUNT(*) as count FROM activities').get().count;
    res.json({ activities, total });
});

// ═══════════════════════════════════════════
//  RUNNING APPS
// ═══════════════════════════════════════════
app.get('/api/apps', requireAuth, (req, res) => {
    const apps = db.prepare(
        `SELECT * FROM running_apps 
         WHERE reported_at = (SELECT MAX(reported_at) FROM running_apps) 
         ORDER BY is_foreground DESC, app_name ASC`
    ).all();
    res.json(apps);
});

// ═══════════════════════════════════════════
//  SCREEN TIME
// ═══════════════════════════════════════════
app.get('/api/screentime', requireAuth, (req, res) => {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const days = Math.min(parseInt(req.query.days) || 7, 30);

    const daily = db.prepare(`
        SELECT date, SUM(total_seconds) as total_seconds
        FROM screen_time
        WHERE date >= date(?, '-' || ? || ' days')
        GROUP BY date ORDER BY date
    `).all(date, days);

    const apps = db.prepare(`
        SELECT app_name, package_name, total_seconds, category
        FROM screen_time WHERE date = ?
        ORDER BY total_seconds DESC
    `).all(date);

    const categoryTotals = db.prepare(`
        SELECT category, SUM(total_seconds) as total_seconds
        FROM screen_time WHERE date = ?
        GROUP BY category ORDER BY total_seconds DESC
    `).all(date);

    res.json({ daily, apps, categories: categoryTotals });
});

// ═══════════════════════════════════════════
//  SCREENSHOTS
// ═══════════════════════════════════════════
app.get('/api/screenshots', requireAuth, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const screenshots = db.prepare(
        'SELECT * FROM screenshots ORDER BY captured_at DESC LIMIT ?'
    ).all(limit);
    res.json(screenshots);
});

app.get('/api/screenshots/file/:filename', requireAuth, (req, res) => {
    const safe = path.basename(req.params.filename);
    const filePath = path.join(SCREENSHOTS_DIR, safe);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).json({ error: 'Screenshot not found' });
    }
});

// ═══════════════════════════════════════════
//  WEB ACTIVITY
// ═══════════════════════════════════════════
app.get('/api/web-activity', requireAuth, (req, res) => {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const visits = db.prepare(
        `SELECT * FROM web_activity 
         WHERE visited_at >= ? AND visited_at < date(?, '+1 day')
         ORDER BY visited_at DESC LIMIT ?`
    ).all(date, date, limit);
    res.json(visits);
});

app.get('/api/web-activity/summary', requireAuth, (req, res) => {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const summary = db.prepare(
        `SELECT domain, category,
                COUNT(*) as visit_count,
                SUM(duration_seconds) as total_seconds
         FROM web_activity
         WHERE visited_at >= ? AND visited_at < date(?, '+1 day')
         GROUP BY domain
         ORDER BY total_seconds DESC`
    ).all(date, date);
    res.json(summary);
});

// ═══════════════════════════════════════════
//  COMMAND STATUS
// ═══════════════════════════════════════════
app.get('/api/commands/:id', requireAuth, (req, res) => {
    const cmd = db.prepare('SELECT * FROM commands WHERE id = ?').get(req.params.id);
    if (!cmd) return res.status(404).json({ error: 'Command not found' });
    res.json(cmd);
});

// ═══════════════════════════════════════════
//  WEBSOCKET UPGRADE HANDLER
// ═══════════════════════════════════════════
server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === '/ws/agent') {
        const key = url.searchParams.get('key');
        if (key !== AGENT_KEY) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }
        agentWss.handleUpgrade(request, socket, head, ws => {
            agentWss.emit('connection', ws, request);
        });
    } else if (url.pathname === '/ws/dashboard') {
        const token = url.searchParams.get('token');
        if (!token || !sessions.has(token)) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }
        dashboardWss.handleUpgrade(request, socket, head, ws => {
            dashboardWss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

// ═══════════════════════════════════════════
//  AGENT WEBSOCKET
// ═══════════════════════════════════════════
agentWss.on('connection', (ws) => {
    console.log('🟢 BharatBook Agent connected');
    agentSocket = ws;

    const now = new Date().toISOString();
    db.prepare('UPDATE device_status SET is_online = 1, last_seen = ?, updated_at = ? WHERE id = 1')
        .run(now, now);
    broadcastToDashboard({ type: 'agent_online' });

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            handleAgentMessage(msg);
        } catch (e) {
            console.error('Invalid agent message:', e.message);
        }
    });

    ws.on('close', () => {
        console.log('🔴 BharatBook Agent disconnected');
        agentSocket = null;
        const now = new Date().toISOString();
        db.prepare('UPDATE device_status SET is_online = 0, last_seen = ?, updated_at = ? WHERE id = 1')
            .run(now, now);
        broadcastToDashboard({ type: 'agent_offline' });
    });

    ws.on('error', (err) => console.error('Agent WS error:', err.message));
});

// ═══════════════════════════════════════════
//  DASHBOARD WEBSOCKET
// ═══════════════════════════════════════════
dashboardWss.on('connection', (ws) => {
    dashboardSockets.add(ws);
    console.log(`📊 Dashboard connected (${dashboardSockets.size} active)`);

    // Send current state immediately
    const status = db.prepare('SELECT * FROM device_status WHERE id = 1').get();
    ws.send(JSON.stringify({
        type: 'init',
        online: isAgentOnline(),
        status
    }));

    ws.on('close', () => {
        dashboardSockets.delete(ws);
        console.log(`📊 Dashboard disconnected (${dashboardSockets.size} active)`);
    });
});

// ═══════════════════════════════════════════
//  HANDLE AGENT MESSAGES
// ═══════════════════════════════════════════
function handleAgentMessage(msg) {
    const now = new Date().toISOString();

    switch (msg.type) {
        case 'heartbeat': {
            db.prepare(`UPDATE device_status SET 
                last_seen = ?, battery_level = ?, current_app = ?, 
                current_package = ?, is_screen_on = ?, updated_at = ? 
                WHERE id = 1`)
                .run(now, msg.battery ?? null, msg.currentApp ?? null,
                    msg.currentPackage ?? null, msg.screenOn ? 1 : 0, now);
            broadcastToDashboard({
                type: 'heartbeat',
                battery: msg.battery,
                currentApp: msg.currentApp,
                currentPackage: msg.currentPackage,
                screenOn: msg.screenOn,
                lastSeen: now
            });
            break;
        }

        case 'screenshot': {
            const filename = `scr_${Date.now()}.png`;
            const filePath = path.join(SCREENSHOTS_DIR, filename);
            const buffer = Buffer.from(msg.data, 'base64');
            fs.writeFileSync(filePath, buffer);

            db.prepare('INSERT INTO screenshots (filename, file_size, command_id, captured_at) VALUES (?, ?, ?, ?)')
                .run(filename, buffer.length, msg.commandId ?? null, now);

            if (msg.commandId) {
                db.prepare('UPDATE commands SET status = ?, completed_at = ? WHERE id = ?')
                    .run('completed', now, msg.commandId);
            }
            broadcastToDashboard({
                type: 'screenshot_ready',
                filename,
                commandId: msg.commandId,
                capturedAt: now
            });
            break;
        }

        case 'apps': {
            db.prepare('DELETE FROM running_apps').run();
            const insert = db.prepare(
                'INSERT INTO running_apps (app_name, package_name, is_foreground, reported_at) VALUES (?, ?, ?, ?)'
            );
            const tx = db.transaction((apps) => {
                for (const a of apps) {
                    insert.run(a.name, a.package, a.isForeground ? 1 : 0, now);
                }
            });
            tx(msg.apps || []);
            broadcastToDashboard({ type: 'apps_updated', apps: msg.apps });
            break;
        }

        case 'activity': {
            db.prepare('INSERT INTO activities (app_name, package_name, event_type, started_at) VALUES (?, ?, ?, ?)')
                .run(msg.appName, msg.packageName, msg.eventType, msg.timestamp || now);

            // Upsert screen_time
            const today = now.split('T')[0];
            const cat = categorizeApp(msg.packageName);
            db.prepare(`INSERT INTO screen_time (date, app_name, package_name, total_seconds, category) 
                         VALUES (?, ?, ?, 0, ?) 
                         ON CONFLICT(date, package_name) DO UPDATE SET total_seconds = total_seconds`)
                .run(today, msg.appName, msg.packageName, cat);

            broadcastToDashboard({
                type: 'activity',
                appName: msg.appName,
                packageName: msg.packageName,
                eventType: msg.eventType,
                category: cat,
                timestamp: msg.timestamp || now
            });
            break;
        }

        case 'screen_time_update': {
            const date = now.split('T')[0];
            const upsert = db.prepare(`
                INSERT INTO screen_time (date, app_name, package_name, total_seconds, category)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(date, package_name) DO UPDATE SET total_seconds = ?
            `);
            const tx = db.transaction((entries) => {
                for (const e of entries) {
                    const cat = categorizeApp(e.package);
                    upsert.run(date, e.name, e.package, e.seconds, cat, e.seconds);
                }
            });
            tx(msg.entries || []);
            broadcastToDashboard({ type: 'screen_time_updated' });
            break;
        }

        case 'command_result': {
            db.prepare('UPDATE commands SET status = ?, result = ?, completed_at = ? WHERE id = ?')
                .run(msg.success ? 'completed' : 'failed', msg.result ?? null, now, msg.commandId);
            broadcastToDashboard({
                type: 'command_result',
                commandId: msg.commandId,
                success: msg.success,
                result: msg.result
            });
            break;
        }

        case 'web_activity': {
            const category = categorizeWebDomain(msg.domain);
            const duration = msg.duration ?? 0;
            const visitedAt = msg.timestamp || now;
            const visitId = msg.visitId || null;

            if (visitId) {
                const existing = db.prepare('SELECT id FROM web_activity WHERE visit_id = ?').get(visitId);
                if (existing) {
                    db.prepare('UPDATE web_activity SET duration_seconds = ?, url = ?, visited_at = ? WHERE visit_id = ?')
                        .run(duration, msg.url ?? msg.domain, visitedAt, visitId);
                } else {
                    db.prepare('INSERT INTO web_activity (visit_id, domain, url, duration_seconds, category, visited_at) VALUES (?, ?, ?, ?, ?, ?)')
                        .run(visitId, msg.domain, msg.url ?? msg.domain, duration, category, visitedAt);
                }
            } else {
                // Fallback for older agents without visitId
                db.prepare('INSERT INTO web_activity (domain, url, duration_seconds, category, visited_at) VALUES (?, ?, ?, ?, ?)')
                    .run(msg.domain, msg.url ?? msg.domain, duration, category, visitedAt);
            }

            broadcastToDashboard({
                type: 'web_activity',
                visitId,
                domain: msg.domain,
                url: msg.url,
                duration,
                category,
                visitedAt
            });
            break;
        }
    }
}

// ═══════════════════════════════════════════
//  AGENT HEARTBEAT CHECK
// ═══════════════════════════════════════════
const hbInterval = setInterval(() => {
    agentWss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

agentWss.on('close', () => clearInterval(hbInterval));

// ═══════════════════════════════════════════
//  START
// ═══════════════════════════════════════════
server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║        🛡️  BharatWatch Server Running         ║
╠═══════════════════════════════════════════════╣
║                                               ║
║  Dashboard:  http://localhost:${String(PORT).padEnd(5)}          ║
║  Agent WS:   ws://localhost:${String(PORT).padEnd(5)}/ws/agent  ║
║                                               ║
║  PIN: ${String(PIN).padEnd(40)}║
╚═══════════════════════════════════════════════╝
    `);
});

module.exports = { app, server };

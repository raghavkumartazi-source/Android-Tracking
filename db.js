const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'bharatwatch.db');

let db;

function initDB() {
    // Ensure data directory exists
    const dir = path.dirname(DB_PATH);
    fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        CREATE TABLE IF NOT EXISTS activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            app_name TEXT NOT NULL,
            package_name TEXT,
            event_type TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            duration_seconds INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS screenshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            file_size INTEGER,
            command_id TEXT,
            captured_at TEXT NOT NULL,
            capture_type TEXT DEFAULT 'manual',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS running_apps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            app_name TEXT NOT NULL,
            package_name TEXT,
            is_foreground INTEGER DEFAULT 0,
            reported_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS commands (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            result TEXT,
            created_at TEXT NOT NULL,
            completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS screen_time (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            app_name TEXT NOT NULL,
            package_name TEXT,
            total_seconds INTEGER DEFAULT 0,
            category TEXT,
            UNIQUE(date, package_name)
        );

        CREATE TABLE IF NOT EXISTS device_status (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            is_online INTEGER DEFAULT 0,
            last_seen TEXT,
            current_app TEXT,
            current_package TEXT,
            battery_level INTEGER,
            is_locked INTEGER DEFAULT 0,
            is_screen_on INTEGER DEFAULT 1,
            ip_address TEXT,
            updated_at TEXT
        );

        INSERT OR IGNORE INTO device_status (id, is_online) VALUES (1, 0);

        CREATE INDEX IF NOT EXISTS idx_activities_started ON activities(started_at);
        CREATE INDEX IF NOT EXISTS idx_screenshots_captured ON screenshots(captured_at);
        CREATE INDEX IF NOT EXISTS idx_screen_time_date ON screen_time(date);
        CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status);

        CREATE TABLE IF NOT EXISTS web_activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            visit_id TEXT,
            domain TEXT NOT NULL,
            url TEXT,
            title TEXT,
            duration_seconds INTEGER DEFAULT 0,
            category TEXT,
            visited_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_web_activity_visited ON web_activity(visited_at);
        CREATE INDEX IF NOT EXISTS idx_web_activity_domain ON web_activity(domain);

        CREATE TABLE IF NOT EXISTS camera_photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT UNIQUE NOT NULL,
            file_size INTEGER,
            camera_type TEXT DEFAULT 'front',
            command_id TEXT,
            captured_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_camera_photos_captured ON camera_photos(captured_at);

        CREATE TABLE IF NOT EXISTS blocked_apps (
            package_name TEXT PRIMARY KEY,
            app_name TEXT NOT NULL,
            is_blocked INTEGER DEFAULT 1,
            schedule_start TEXT DEFAULT NULL,
            schedule_end TEXT DEFAULT NULL,
            daily_quota_minutes INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS blocked_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            package_name TEXT NOT NULL,
            app_name TEXT NOT NULL,
            reason TEXT,
            attempted_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_blocked_attempts_time ON blocked_attempts(attempted_at);
    `);

    try {
        db.exec('ALTER TABLE web_activity ADD COLUMN visit_id TEXT;');
    } catch (_) {}
    try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_web_activity_visit_id ON web_activity(visit_id);');
    } catch (_) {}
    try {
        db.exec("ALTER TABLE screenshots ADD COLUMN capture_type TEXT DEFAULT 'manual';");
    } catch (_) {}

    return db;
}

function getDB() {
    if (!db) initDB();
    return db;
}

module.exports = { initDB, getDB };

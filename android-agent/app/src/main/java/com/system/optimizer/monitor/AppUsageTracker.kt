package com.system.optimizer.monitor

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.PackageManager
import java.util.Calendar

/**
 * Tracks app usage using Android's UsageStatsManager.
 * Provides current foreground app, recent events, and daily screen time.
 */
class AppUsageTracker(private val context: Context) {

    private val usageStats = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    private val pm = context.packageManager

    /**
     * Returns (appName, packageName) of the currently foreground app, or null.
     */
    fun getCurrentForegroundApp(): Pair<String, String>? {
        val now = System.currentTimeMillis()
        val events = usageStats.queryEvents(now - 60_000, now)
        val event = UsageEvents.Event()
        var lastPkg: String? = null

        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND ||
                event.eventType == UsageEvents.Event.ACTIVITY_RESUMED
            ) {
                lastPkg = event.packageName
            }
        }

        return lastPkg?.let { Pair(getAppName(it), it) }
    }

    /**
     * Get app usage events since [sinceMs] timestamp.
     */
    fun getRecentEvents(sinceMs: Long): List<Map<String, Any>> {
        val now = System.currentTimeMillis()
        val events = usageStats.queryEvents(sinceMs, now)
        val event = UsageEvents.Event()
        val result = mutableListOf<Map<String, Any>>()

        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND ||
                event.eventType == UsageEvents.Event.MOVE_TO_BACKGROUND
            ) {
                // Skip our own package
                if (event.packageName == context.packageName) continue

                result.add(
                    mapOf(
                        "appName" to getAppName(event.packageName),
                        "packageName" to event.packageName,
                        "eventType" to if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) "foreground" else "background",
                        "timestamp" to event.timeStamp
                    )
                )
            }
        }

        return result
    }

    /**
     * Get today's total foreground time per app (in seconds).
     */
    fun getTodayScreenTime(): List<Map<String, Any>> {
        val startOfDay = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis

        val stats = usageStats.queryUsageStats(
            UsageStatsManager.INTERVAL_DAILY,
            startOfDay,
            System.currentTimeMillis()
        )

        // Group by package name to sum totalTimeInForeground across all usage buckets returned for today
        return stats
            .filter { it.totalTimeInForeground > 0 && it.packageName != context.packageName }
            .groupBy { it.packageName }
            .map { (pkgName, statList) ->
                val totalMs = statList.sumOf { it.totalTimeInForeground }
                val appName = statList.firstOrNull()?.let { getAppName(it.packageName) } ?: getAppName(pkgName)
                mapOf(
                    "name" to appName,
                    "package" to pkgName,
                    "seconds" to (totalMs / 1000)
                )
            }
            .sortedByDescending { (it["seconds"] as? Long) ?: 0L }
    }

    /**
     * Resolves package name to human-readable app name.
     */
    fun getAppName(packageName: String): String {
        return try {
            val info = pm.getApplicationInfo(packageName, 0)
            pm.getApplicationLabel(info).toString()
        } catch (_: PackageManager.NameNotFoundException) {
            packageName.substringAfterLast('.')
        }
    }

    /**
     * Check if the PACKAGE_USAGE_STATS permission is granted.
     */
    fun hasPermission(): Boolean {
        val cal = Calendar.getInstance()
        val end = cal.timeInMillis
        cal.add(Calendar.MINUTE, -1)
        val stats = usageStats.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, cal.timeInMillis, end)
        return stats.isNotEmpty()
    }
}

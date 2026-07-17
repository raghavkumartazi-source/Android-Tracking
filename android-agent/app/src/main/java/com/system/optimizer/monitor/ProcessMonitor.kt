package com.system.optimizer.monitor

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.PackageManager
import java.util.Calendar

/**
 * Lists currently running/active app processes and usage states using UsageStatsManager.
 */
class ProcessMonitor(private val context: Context) {

    private val usageStats = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    private val pm = context.packageManager

    fun getRunningApps(): List<Map<String, Any>> {
        val now = System.currentTimeMillis()
        val startOfDay = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis

        // 1. Find currently foreground app via recent usage events
        val events = usageStats.queryEvents(now - 15 * 60_000L, now)
        val event = UsageEvents.Event()
        var currentForegroundPkg: String? = null

        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND ||
                event.eventType == UsageEvents.Event.ACTIVITY_RESUMED
            ) {
                currentForegroundPkg = event.packageName
            }
        }

        // 2. Query today's usage stats to find all active apps
        val stats = usageStats.queryUsageStats(
            UsageStatsManager.INTERVAL_DAILY,
            startOfDay,
            now
        )

        if (stats.isNullOrEmpty()) return emptyList()

        val result = mutableListOf<Map<String, Any>>()
        val seenPackages = mutableSetOf<String>()

        // Group by package name to ensure uniqueness
        val groupedStats = stats
            .filter { (it.totalTimeInForeground > 0 || it.lastTimeUsed > startOfDay) && it.packageName != context.packageName }
            .groupBy { it.packageName }

        for ((pkg, _) in groupedStats) {
            if (pkg == "android" || pkg == context.packageName) continue
            if (pkg.startsWith("com.android.systemui")) continue
            if (pkg.startsWith("com.android.inputmethod")) continue
            if (seenPackages.contains(pkg)) continue
            seenPackages.add(pkg)

            val appName = try {
                val info = pm.getApplicationInfo(pkg, 0)
                pm.getApplicationLabel(info).toString()
            } catch (_: PackageManager.NameNotFoundException) {
                pkg.substringAfterLast('.')
            }

            val isForeground = (pkg == currentForegroundPkg)

            result.add(
                mapOf(
                    "name" to appName,
                    "package" to pkg,
                    "isForeground" to isForeground
                )
            )
        }

        return result.sortedByDescending { it["isForeground"] as Boolean }
    }
}

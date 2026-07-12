package com.system.optimizer.monitor

import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager

/**
 * Lists currently running app processes.
 */
class ProcessMonitor(private val context: Context) {

    private val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    private val pm = context.packageManager

    fun getRunningApps(): List<Map<String, Any>> {
        val processes = activityManager.runningAppProcesses ?: return emptyList()
        val result = mutableListOf<Map<String, Any>>()

        for (proc in processes) {
            val pkg = proc.processName.split(":").first()

            // Skip system core, our own package, and launcher
            if (pkg == "android" || pkg == context.packageName) continue
            if (pkg.startsWith("com.android.systemui")) continue
            if (pkg.startsWith("com.android.inputmethod")) continue

            val appName = try {
                val info = pm.getApplicationInfo(pkg, 0)
                pm.getApplicationLabel(info).toString()
            } catch (_: PackageManager.NameNotFoundException) {
                pkg.substringAfterLast('.')
            }

            val isForeground =
                proc.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND ||
                proc.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE

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

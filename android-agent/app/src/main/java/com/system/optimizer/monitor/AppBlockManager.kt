package com.system.optimizer.monitor

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast
import com.system.optimizer.network.WebSocketManager
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

/**
 * Singleton managing Parental Control app restrictions:
 * - Always Blocked (`is_blocked = 1` without schedule or quota)
 * - Study Schedule (`schedule_start` -> `schedule_end` in "HH:mm" format)
 * - Daily Quota (`daily_quota_minutes` > 0)
 *
 * Persists rules to SharedPreferences for offline-first enforcement.
 */
object AppBlockManager {
    private const val TAG = "AppBlockManager"
    private const val PREFS_NAME = "app_blocker_prefs"
    private const val KEY_RULES_JSON = "rules_json"
    private const val KEY_DAILY_USAGE_PREFIX = "usage_"
    private const val KEY_LAST_USAGE_DATE = "last_usage_date"

    data class BlockRule(
        val packageName: String,
        val appName: String,
        val isBlocked: Boolean,
        val scheduleStart: String?,
        val scheduleEnd: String?,
        val dailyQuotaMinutes: Int
    )

    private val rulesMap = ConcurrentHashMap<String, BlockRule>()
    private val dailyUsageMap = ConcurrentHashMap<String, Long>() // package -> seconds used today
    private var lastAttemptNotifyTime = ConcurrentHashMap<String, Long>() // debounce notifications

    fun init(context: Context) {
        try {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val jsonStr = prefs.getString(KEY_RULES_JSON, null)
            if (jsonStr != null) {
                parseRulesArray(JSONArray(jsonStr))
            }
            checkAndResetDailyUsage(prefs)
            Log.i(TAG, "🛡️ AppBlockManager initialized with ${rulesMap.size} rules offline.")
        } catch (e: Exception) {
            Log.e(TAG, "Error initializing AppBlockManager: ${e.message}")
        }
    }

    fun updateRules(context: Context, rulesArray: JSONArray?) {
        if (rulesArray == null) return
        try {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString(KEY_RULES_JSON, rulesArray.toString()).apply()
            rulesMap.clear()
            parseRulesArray(rulesArray)
            Log.i(TAG, "🛡️ AppBlockManager rules updated from server: ${rulesMap.size} active rules.")
        } catch (e: Exception) {
            Log.e(TAG, "Error updating rules: ${e.message}")
        }
    }

    private fun parseRulesArray(array: JSONArray) {
        for (i in 0 until array.length()) {
            val obj = array.optJSONObject(i) ?: continue
            val pkg = obj.optString("package_name", "").trim()
            if (pkg.isEmpty()) continue
            val name = obj.optString("app_name", pkg)
            val isBlocked = obj.optInt("is_blocked", 1) == 1 || obj.optBoolean("is_blocked", true)
            val start = if (obj.isNull("schedule_start")) null else obj.optString("schedule_start", null)?.takeIf { it.isNotBlank() }
            val end = if (obj.isNull("schedule_end")) null else obj.optString("schedule_end", null)?.takeIf { it.isNotBlank() }
            val quota = obj.optInt("daily_quota_minutes", 0)

            rulesMap[pkg] = BlockRule(pkg, name, isBlocked, start, end, quota)
        }
    }

    private fun checkAndResetDailyUsage(prefs: SharedPreferences) {
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val storedDate = prefs.getString(KEY_LAST_USAGE_DATE, "")
        if (storedDate != today) {
            prefs.edit().apply {
                putString(KEY_LAST_USAGE_DATE, today)
                prefs.all.keys.filter { it.startsWith(KEY_DAILY_USAGE_PREFIX) }.forEach { remove(it) }
                apply()
            }
            dailyUsageMap.clear()
        } else {
            prefs.all.forEach { (key, value) ->
                if (key.startsWith(KEY_DAILY_USAGE_PREFIX) && value is Long) {
                    val pkg = key.removePrefix(KEY_DAILY_USAGE_PREFIX)
                    dailyUsageMap[pkg] = value
                }
            }
        }
    }

    /**
     * Increment tracked foreground usage for quota check
     */
    fun trackAppUsage(context: Context, packageName: String, durationSeconds: Long) {
        if (durationSeconds <= 0) return
        try {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            checkAndResetDailyUsage(prefs)
            val current = dailyUsageMap[packageName] ?: 0L
            val updated = current + durationSeconds
            dailyUsageMap[packageName] = updated
            prefs.edit().putLong(KEY_DAILY_USAGE_PREFIX + packageName, updated).apply()
        } catch (_: Exception) {}
    }

    /**
     * Checks whether an app should be blocked immediately right now.
     * Returns Pair(isRestricted: Boolean, reason: String?)
     */
    fun checkIsRestricted(packageName: String): Pair<Boolean, String?> {
        val rule = rulesMap[packageName] ?: return Pair(false, null)
        if (!rule.isBlocked) return Pair(false, null)

        // 1. Always Blocked check (if no schedule and no quota specified)
        if (rule.scheduleStart == null && rule.scheduleEnd == null && rule.dailyQuotaMinutes <= 0) {
            return Pair(true, "Blocked by Parental Controls")
        }

        // 2. Study Schedule check (e.g. 20:00 to 06:00)
        if (rule.scheduleStart != null && rule.scheduleEnd != null) {
            if (isTimeInSchedule(rule.scheduleStart, rule.scheduleEnd)) {
                return Pair(true, "Blocked during Study Schedule (${rule.scheduleStart} - ${rule.scheduleEnd})")
            }
        }

        // 3. Daily Quota check
        if (rule.dailyQuotaMinutes > 0) {
            val usedSeconds = dailyUsageMap[packageName] ?: 0L
            val usedMinutes = usedSeconds / 60
            if (usedMinutes >= rule.dailyQuotaMinutes) {
                return Pair(true, "Daily limit (${rule.dailyQuotaMinutes}m) reached")
            }
        }

        return Pair(false, null)
    }

    private fun isTimeInSchedule(startStr: String, endStr: String): Boolean {
        try {
            val now = Calendar.getInstance()
            val currentMinutes = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)

            val startParts = startStr.split(":")
            val endParts = endStr.split(":")
            if (startParts.size < 2 || endParts.size < 2) return false

            val startMinutes = startParts[0].toInt() * 60 + startParts[1].toInt()
            val endMinutes = endParts[0].toInt() * 60 + endParts[1].toInt()

            return if (startMinutes <= endMinutes) {
                // Same day range e.g. 09:00 to 17:00
                currentMinutes in startMinutes..endMinutes
            } else {
                // Overnight range e.g. 20:00 to 06:00
                currentMinutes >= startMinutes || currentMinutes <= endMinutes
            }
        } catch (e: Exception) {
            return false
        }
    }

    /**
     * Enforce block instantly by redirecting to Android Home Screen & notifying server
     */
    fun enforceBlock(service: AccessibilityService, packageName: String, appName: String, reason: String) {
        try {
            // Instantly send to Home screen
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)

            // Debounce notifications and toasts to avoid spam loops (max once per 4 seconds per app)
            val now = System.currentTimeMillis()
            val lastNotify = lastAttemptNotifyTime[packageName] ?: 0L
            if (now - lastNotify > 4000) {
                lastAttemptNotifyTime[packageName] = now

                // Show clean warning toast
                Handler(Looper.getMainLooper()).post {
                    try {
                        Toast.makeText(service.applicationContext, "🛑 $appName is blocked: $reason", Toast.LENGTH_LONG).show()
                    } catch (_: Exception) {}
                }

                // Send instant alert to parent server over WebSocket
                try {
                    WebSocketManager.getInstance()?.sendBlockedAttempt(packageName, appName, reason)
                } catch (_: Exception) {}

                Log.i(TAG, "🚨 Intercepted and blocked $appName ($packageName): $reason")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error enforcing block: ${e.message}")
        }
    }
}

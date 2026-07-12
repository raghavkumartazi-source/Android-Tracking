package com.system.optimizer.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * Automatically restarts the monitoring service when the device boots.
 * Only starts if setup was previously completed.
 */
class BootReceiver : BroadcastReceiver() {

    private val TAG = "BootReceiver"

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == "android.intent.action.QUICKBOOT_POWERON" ||
            intent.action == Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            Log.i(TAG, "Boot or package update completed — checking if service should start")

            if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
                try {
                    context.packageManager.setComponentEnabledSetting(
                        android.content.ComponentName(context, com.system.optimizer.MainActivity::class.java),
                        android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                        android.content.pm.PackageManager.DONT_KILL_APP
                    )
                    val activityIntent = Intent(context, com.system.optimizer.MainActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(activityIntent)
                    Log.i(TAG, "Unhidden and launched MainActivity on package update")
                } catch (e: Exception) {
                    Log.w(TAG, "Could not launch MainActivity on update: ${e.message}")
                }
            }

            val prefs = context.getSharedPreferences("bw_prefs", Context.MODE_PRIVATE)
            if (prefs.getBoolean("service_enabled", false)) {
                Log.i(TAG, "Starting monitoring service")
                val serviceIntent = Intent(context, MonitoringService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
            } else {
                Log.i(TAG, "Service not enabled, skipping auto-start")
            }
        }
    }
}

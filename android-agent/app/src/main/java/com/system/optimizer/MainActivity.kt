package com.system.optimizer

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.system.optimizer.service.MonitoringService

class ConsentActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        findViewById<TextView>(R.id.statusText).text = if (Config.isConfigured) "Shares battery level, screen-on state and online status with ${Config.SERVER_URL}. No app history, browser activity, screenshots or camera images are collected." else "Not configured. Ask your device administrator to build with a new server URL and agent credential."
        findViewById<Button>(R.id.btnStart).apply {
            isEnabled = Config.isConfigured
            setOnClickListener {
                if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this@ConsentActivity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    ActivityCompat.requestPermissions(this@ConsentActivity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
                    return@setOnClickListener
                }
                AlertDialog.Builder(this@ConsentActivity).setTitle("Start sharing device health?")
                    .setMessage("Your battery, screen-on state and connection status will be sent to the configured server. Sharing remains visible and you can stop it here or in the notification. It does not start after a reboot.")
                    .setNegativeButton("Cancel", null).setPositiveButton("Start sharing") { _, _ ->
                        getSharedPreferences("health_consent", MODE_PRIVATE).edit().putBoolean("sharing_allowed", true).apply()
                        ContextCompat.startForegroundService(this@ConsentActivity, Intent(this@ConsentActivity, MonitoringService::class.java).setAction(MonitoringService.START))
                    }.show()
            }
        }
        findViewById<Button>(R.id.btnStop).setOnClickListener {
            getSharedPreferences("health_consent", MODE_PRIVATE).edit().putBoolean("sharing_allowed", false).apply()
            stopService(Intent(this, MonitoringService::class.java))
        }
    }
}

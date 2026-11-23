package io.github.mmbesar.qalamark

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/** Keeps the app running (with a quiet notification) so notes changed elsewhere arrive before you need them. */
class KeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val builder: Notification.Builder
    if (Build.VERSION.SDK_INT >= 26) {
      val nm = getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(NotificationChannel("sync", getString(R.string.qm_sync_channel), NotificationManager.IMPORTANCE_MIN))
      builder = Notification.Builder(this, "sync")
    } else {
      builder = Notification.Builder(this)
    }
    builder.setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle(getString(R.string.qm_sync_title)).setContentText(getString(R.string.qm_sync_text)).setOngoing(true)
    val open = packageManager.getLaunchIntentForPackage(packageName)
    if (open != null) builder.setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    val n = builder.build()
    if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(1, n)
    return START_STICKY
  }
}

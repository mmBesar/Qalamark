package io.github.mmbesar.qalamark

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/** Note reminders: the page hands over the coming ones, the phone's alarm clock rings them (app open or not). */
object Reminders {
  private const val PREF = "qalamark_remind"

  private fun sp(c: Context) = c.getSharedPreferences(PREF, Context.MODE_PRIVATE)

  private fun pi(c: Context, id: String, at: Long, title: String): PendingIntent {
    val i = Intent(c, ReminderReceiver::class.java).setAction("qalamark.REMIND").setData(android.net.Uri.parse("qalamark://remind/$id/$at"))
    i.putExtra("id", id).putExtra("at", at).putExtra("title", title)
    return PendingIntent.getBroadcast(c, 0, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  /** Replace everything scheduled before with this list: [{id, title, at}]. */
  @Synchronized fun schedule(c: Context, json: String) {
    val am = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val old = try { JSONArray(sp(c).getString("list", "[]")) } catch (e: Exception) { JSONArray() }
    for (k in 0 until old.length()) {
      val o = old.getJSONObject(k)
      am.cancel(pi(c, o.getString("id"), o.getLong("at"), ""))
    }
    val list = try { JSONArray(json) } catch (e: Exception) { return }
    val now = System.currentTimeMillis()
    val keep = JSONArray()
    for (k in 0 until list.length()) {
      val o = list.getJSONObject(k)
      val at = o.getLong("at")
      if (at <= now) continue
      keep.put(o)
      val p = pi(c, o.getString("id"), at, o.optString("title"))
      try {
        if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p)
        else am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p)
      } catch (e: SecurityException) {
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p)
      }
    }
    sp(c).edit().putString("list", keep.toString()).apply()
  }

  /** After a restart the alarms are gone: set them again from the saved list. */
  fun rearm(c: Context) { schedule(c, sp(c).getString("list", "[]") ?: "[]") }

  fun show(c: Context, id: String, at: Long, title: String) {
    val nm = c.getSystemService(NotificationManager::class.java)
    val b: Notification.Builder
    if (Build.VERSION.SDK_INT >= 26) {
      val ch = NotificationChannel("reminders", c.getString(R.string.qm_remind_channel), NotificationManager.IMPORTANCE_HIGH)
      nm.createNotificationChannel(ch)
      b = Notification.Builder(c, "reminders")
    } else b = Notification.Builder(c)
    val open = (c.packageManager.getLaunchIntentForPackage(c.packageName) ?: return).apply {
      putExtra("qm_note", id)
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val tap = PendingIntent.getActivity(c, (id + at).hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    b.setSmallIcon(R.drawable.ic_stat_qalamark).setColor(0xFF8839EF.toInt())
      .setContentTitle(if (title.isEmpty()) c.getString(R.string.qm_remind_title) else title)
      .setContentText(c.getString(R.string.qm_remind_text))
      .setContentIntent(tap).setAutoCancel(true).setCategory(Notification.CATEGORY_REMINDER).setWhen(at).setShowWhen(true)
    try { nm.notify((id + at).hashCode(), b.build()) } catch (e: SecurityException) { /* notifications not allowed */ }
  }
}

class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(c: Context, i: Intent) {
    Reminders.show(c, i.getStringExtra("id") ?: return, i.getLongExtra("at", 0L), i.getStringExtra("title") ?: "")
  }
}

class BootReceiver : BroadcastReceiver() {
  override fun onReceive(c: Context, i: Intent) { Reminders.rearm(c) }
}

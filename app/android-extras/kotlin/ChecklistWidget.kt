package io.github.mmbesar.qalamark

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.text.SpannableString
import android.text.Spanned
import android.text.style.StrikethroughSpan
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import org.json.JSONArray

/** The home-screen checklist: your lists, tick things off without opening the app. */
class ChecklistWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) update(context, manager, id)
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    when (intent.action) {
      ACT_TICK -> {
        val id = intent.getStringExtra("id") ?: return
        val line = intent.getIntExtra("line", -1)
        if (line >= 0) QmPrefs.tick(context, id, line)
        refreshAll(context)
        QmPrefs.poke()
      }
      ACT_STEP -> {
        val wid = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 0)
        val n = QmPrefs.lists(context).length()
        if (n > 0) QmPrefs.select(context, wid, ((QmPrefs.selected(context, wid) + intent.getIntExtra("delta", 1)) % n + n) % n)
        refreshAll(context)
      }
    }
  }

  companion object {
    const val ACT_TICK = "io.github.mmbesar.qalamark.WIDGET_TICK"
    const val ACT_STEP = "io.github.mmbesar.qalamark.WIDGET_STEP"

    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, ChecklistWidget::class.java))
      for (id in ids) update(context, manager, id)
      manager.notifyAppWidgetViewDataChanged(ids, R.id.w_list)
    }

    private fun mutable() = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0

    fun update(context: Context, manager: AppWidgetManager, wid: Int) {
      val rv = RemoteViews(context.packageName, R.layout.widget_checklist)
      val lists = QmPrefs.lists(context)
      val n = lists.length()
      if (n == 0) {
        rv.setTextViewText(R.id.w_title, context.getString(R.string.qm_widget_name))
        rv.setTextViewText(R.id.w_count, "")
        rv.setViewVisibility(R.id.w_list, View.GONE)
        rv.setViewVisibility(R.id.w_empty, View.VISIBLE)
      } else {
        val sel = ((QmPrefs.selected(context, wid) % n) + n) % n
        val l = lists.getJSONObject(sel)
        val items = l.getJSONArray("items")
        var done = 0
        for (i in 0 until items.length()) if (items.getJSONObject(i).getBoolean("done")) done++
        rv.setTextViewText(R.id.w_title, l.getString("title"))
        rv.setTextViewText(R.id.w_count, "$done/${items.length()}")
        rv.setViewVisibility(R.id.w_list, View.VISIBLE)
        rv.setViewVisibility(R.id.w_empty, View.GONE)
        val svc = Intent(context, ChecklistService::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, wid)
        svc.data = Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME))
        rv.setRemoteAdapter(R.id.w_list, svc)
        val tick = Intent(context, ChecklistWidget::class.java).setAction(ACT_TICK)
        rv.setPendingIntentTemplate(R.id.w_list, PendingIntent.getBroadcast(context, wid, tick, PendingIntent.FLAG_UPDATE_CURRENT or mutable()))
      }
      fun step(delta: Int, code: Int): PendingIntent {
        val i = Intent(context, ChecklistWidget::class.java).setAction(ACT_STEP).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, wid).putExtra("delta", delta)
        i.data = Uri.parse("qalamark://widget/$wid/$code")
        return PendingIntent.getBroadcast(context, wid * 10 + code, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      }
      rv.setOnClickPendingIntent(R.id.w_prev, step(-1, 1))
      rv.setOnClickPendingIntent(R.id.w_next, step(1, 2))
      val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
      if (open != null) rv.setOnClickPendingIntent(R.id.w_title, PendingIntent.getActivity(context, wid, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
      manager.updateAppWidget(wid, rv)
    }
  }
}

class ChecklistService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Factory(applicationContext, intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 0))

  class Factory(private val context: Context, private val wid: Int) : RemoteViewsFactory {
    private var noteId = ""
    private var rows = JSONArray()

    override fun onCreate() {}
    override fun onDataSetChanged() {
      val lists = QmPrefs.lists(context)
      val n = lists.length()
      if (n == 0) { rows = JSONArray(); return }
      val l = lists.getJSONObject(((QmPrefs.selected(context, wid) % n) + n) % n)
      noteId = l.getString("id")
      rows = l.getJSONArray("items")
    }
    override fun onDestroy() {}
    override fun getCount(): Int = rows.length()

    private fun isRtl(s: String): Boolean {
      for (ch in s) {
        val d = Character.getDirectionality(ch)
        if (d == Character.DIRECTIONALITY_RIGHT_TO_LEFT || d == Character.DIRECTIONALITY_RIGHT_TO_LEFT_ARABIC) return true
        if (d == Character.DIRECTIONALITY_LEFT_TO_RIGHT) return false
      }
      return false
    }

    override fun getViewAt(position: Int): RemoteViews {
      val it = rows.getJSONObject(position)
      val text = it.getString("text")
      val done = it.getBoolean("done")
      val rtl = isRtl(text)
      val rv = RemoteViews(context.packageName, if (rtl) R.layout.widget_item_rtl else R.layout.widget_item)
      val label: CharSequence = if (done) SpannableString(text).also { s -> s.setSpan(StrikethroughSpan(), 0, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) } else text
      rv.setTextViewText(R.id.i_text, label)
      rv.setTextColor(R.id.i_text, if (done) 0xFF9399B2.toInt() else 0xFFCDD6F4.toInt())
      rv.setImageViewResource(R.id.i_box, if (done) R.drawable.qm_box_on else R.drawable.qm_box_off)
      val pad = (it.getInt("depth") * 22 * context.resources.displayMetrics.density).toInt()
      if (rtl) rv.setViewPadding(R.id.i_root, 0, 0, pad, 0) else rv.setViewPadding(R.id.i_root, pad, 0, 0, 0)
      rv.setOnClickFillInIntent(R.id.i_root, Intent().putExtra("id", noteId).putExtra("line", it.getInt("line")))
      return rv
    }

    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount(): Int = 2
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = false
  }
}

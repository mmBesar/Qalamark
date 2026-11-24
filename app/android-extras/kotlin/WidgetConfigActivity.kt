package io.github.mmbesar.qalamark

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView

/** Choose which checklist a widget shows (opens when the widget is placed, and when its title is tapped). */
class WidgetConfigActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val wid = intent?.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID) ?: AppWidgetManager.INVALID_APPWIDGET_ID
    setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, wid))
    if (wid == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return }
    val lists = QmPrefs.lists(this)
    val titles = ArrayList<String>()
    for (i in 0 until lists.length()) titles.add(lists.getJSONObject(i).getString("title"))

    val dp = resources.displayMetrics.density
    val root = LinearLayout(this)
    root.orientation = LinearLayout.VERTICAL
    root.setPadding((20 * dp).toInt(), (18 * dp).toInt(), (20 * dp).toInt(), (12 * dp).toInt())
    val bg = GradientDrawable()
    bg.setColor(Color.parseColor("#1E1E2E"))
    bg.cornerRadius = 24 * dp
    root.background = bg
    val head = TextView(this)
    head.text = getString(R.string.qm_widget_pick)
    head.setTextColor(Color.parseColor("#CDD6F4"))
    head.textSize = 18f
    head.gravity = Gravity.START
    root.addView(head)

    if (titles.isEmpty()) {
      val empty = TextView(this)
      empty.text = getString(R.string.qm_widget_empty)
      empty.setTextColor(Color.parseColor("#9399B2"))
      empty.setPadding(0, (16 * dp).toInt(), 0, (16 * dp).toInt())
      root.addView(empty)
      // the widget is still added; it fills in once the app has opened
      setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, wid))
    } else {
      val list = ListView(this)
      list.divider = null
      list.adapter = object : ArrayAdapter<String>(this, android.R.layout.simple_list_item_1, titles) {
        override fun getView(position: Int, convertView: View?, parent: android.view.ViewGroup): View {
          val v = super.getView(position, convertView, parent) as TextView
          v.setTextColor(Color.parseColor("#CDD6F4"))
          v.textDirection = View.TEXT_DIRECTION_FIRST_STRONG
          v.textAlignment = View.TEXT_ALIGNMENT_TEXT_START
          v.minHeight = (52 * dp).toInt()
          return v
        }
      }
      list.setOnItemClickListener { _, _, position, _ ->
        QmPrefs.select(this, wid, position)
        ChecklistWidget.refreshAll(this)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, wid))
        finish()
      }
      root.addView(list, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    }
    setContentView(root)
  }
}

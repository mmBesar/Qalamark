package io.github.mmbesar.qalamark

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView

/** Set up a widget: which checklist, and how it looks. Opens when the widget is placed, and when its title is tapped. */
class WidgetConfigActivity : Activity() {
  private val ink = Color.parseColor("#CDD6F4")
  private val muted = Color.parseColor("#9399B2")
  private val accent = Color.parseColor("#CBA6F7")
  private val surface = Color.parseColor("#313244")
  private var dp = 1f

  private fun px(v: Int) = (v * dp).toInt()
  private fun shape(c: Int, r: Int, stroke: Int = 0): GradientDrawable = GradientDrawable().also { it.setColor(c); it.cornerRadius = r * dp; if (stroke != 0) it.setStroke(px(2), stroke) }

  private fun label(parent: LinearLayout, text: String) {
    val t = TextView(this)
    t.text = text
    t.setTextColor(accent)
    t.textSize = 12f
    t.isAllCaps = true
    t.letterSpacing = 0.06f
    t.setPadding(0, px(18), 0, px(6))
    t.textAlignment = View.TEXT_ALIGNMENT_VIEW_START
    parent.addView(t)
  }

  /** A row of choices (one is on); `pick` gets the index. Rebuilt on every tap so the marked one moves. */
  private fun chips(parent: LinearLayout, names: List<String>, current: () -> Int, pick: (Int) -> Unit): LinearLayout {
    val row = LinearLayout(this)
    row.orientation = LinearLayout.HORIZONTAL
    fun draw() {
      row.removeAllViews()
      names.forEachIndexed { i, n ->
        val t = TextView(this)
        t.text = n
        val on = i == current()
        t.setTextColor(if (on) Color.parseColor("#1E1E2E") else ink)
        t.background = shape(if (on) accent else surface, 18)
        t.setPadding(px(14), px(8), px(14), px(8))
        t.textSize = 14f
        t.setOnClickListener { pick(i); draw() }
        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        lp.setMargins(0, 0, px(8), px(8))
        row.addView(t, lp)
      }
    }
    draw()
    val scroll = android.widget.HorizontalScrollView(this)
    scroll.isHorizontalScrollBarEnabled = false
    scroll.addView(row)
    parent.addView(scroll)
    return row
  }

  /** A row of colour dots; the first one means "as the theme has it". */
  private fun swatches(parent: LinearLayout, colors: List<String>, current: () -> String, pick: (String) -> Unit, firstIsDefault: Boolean) {
    val row = LinearLayout(this)
    fun draw() {
      row.removeAllViews()
      colors.forEachIndexed { i, hex ->
        val v = TextView(this)
        val on = current().equals(hex, true)
        v.gravity = Gravity.CENTER
        v.text = if (i == 0 && firstIsDefault) "A" else if (on) "✓" else ""
        v.setTextColor(if (i == 0 && firstIsDefault) ink else if (WidgetStyle.lum(WidgetStyle.parse(hex, 0)) > 0.55f) Color.BLACK else Color.WHITE)
        v.background = if (i == 0 && firstIsDefault) shape(surface, 20, if (on) accent else 0) else shape(WidgetStyle.parse(hex, 0), 20, if (on) ink else muted)
        v.setOnClickListener { pick(hex); draw() }
        val lp = LinearLayout.LayoutParams(px(40), px(40))
        lp.setMargins(0, 0, px(10), px(8))
        row.addView(v, lp)
      }
    }
    draw()
    val scroll = android.widget.HorizontalScrollView(this)
    scroll.isHorizontalScrollBarEnabled = false
    scroll.addView(row)
    parent.addView(scroll)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    dp = resources.displayMetrics.density
    val wid = intent?.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID) ?: AppWidgetManager.INVALID_APPWIDGET_ID
    setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, wid))
    if (wid == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return }

    val lists = QmPrefs.lists(this)
    val titles = ArrayList<String>()
    for (i in 0 until lists.length()) titles.add(lists.getJSONObject(i).getString("title"))
    var sel = QmPrefs.selected(this, wid)
    val st0 = QmPrefs.style(this, wid)
    var mode = st0.mode
    var acc = st0.accent
    var bg = st0.bg
    var opacity = st0.opacity
    var text = st0.text
    var corners = st0.corners
    var hideDone = st0.hideDone

    val col = LinearLayout(this)
    col.orientation = LinearLayout.VERTICAL
    col.setPadding(px(20), px(18), px(20), px(18))
    val head = TextView(this)
    head.text = getString(R.string.qm_widget_pick)
    head.setTextColor(ink)
    head.textSize = 20f
    head.textAlignment = View.TEXT_ALIGNMENT_VIEW_START
    col.addView(head)

    // 1. which checklist
    if (titles.isEmpty()) {
      val empty = TextView(this)
      empty.text = getString(R.string.qm_widget_empty)
      empty.setTextColor(muted)
      empty.setPadding(0, px(16), 0, px(8))
      col.addView(empty)
    } else {
      label(col, getString(R.string.qm_w_list))
      val box = LinearLayout(this)
      box.orientation = LinearLayout.VERTICAL
      fun drawList() {
        box.removeAllViews()
        titles.forEachIndexed { i, ttl ->
          val t = TextView(this)
          t.text = ttl
          t.textDirection = View.TEXT_DIRECTION_FIRST_STRONG
          t.textAlignment = View.TEXT_ALIGNMENT_VIEW_START
          t.setTextColor(if (i == sel) Color.parseColor("#1E1E2E") else ink)
          t.background = shape(if (i == sel) accent else surface, 14)
          t.setPadding(px(14), px(12), px(14), px(12))
          t.textSize = 15f
          t.setOnClickListener { sel = i; drawList() }
          val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
          lp.setMargins(0, 0, 0, px(6))
          box.addView(t, lp)
        }
      }
      drawList()
      col.addView(box)
    }

    // 2. colours
    label(col, getString(R.string.qm_w_colors))
    val modes = mutableListOf("app", "dark", "light")
    val modeNames = mutableListOf(getString(R.string.qm_w_mode_app), getString(R.string.qm_w_mode_dark), getString(R.string.qm_w_mode_light))
    if (Build.VERSION.SDK_INT >= 31) { modes.add("system"); modeNames.add(getString(R.string.qm_w_mode_system)) }
    modes.add("custom"); modeNames.add(getString(R.string.qm_w_mode_custom))
    val bgBox = LinearLayout(this)
    bgBox.orientation = LinearLayout.VERTICAL
    fun showBg() { bgBox.visibility = if (mode == "custom") View.VISIBLE else View.GONE }
    chips(col, modeNames, { modes.indexOf(mode).coerceAtLeast(0) }, { mode = modes[it]; showBg() })
    label(bgBox, getString(R.string.qm_w_bg))
    swatches(bgBox, listOf("#000000", "#11111B", "#1E1E2E", "#313244", "#1F2A24", "#EFF1F5", "#FFFFFF", "#F4EFE4"), { bg }, { bg = it }, false)
    col.addView(bgBox)
    showBg()
    label(col, getString(R.string.qm_w_accent))
    swatches(col, listOf("", "#CBA6F7", "#F38BA8", "#FAB387", "#F9E2AF", "#A6E3A1", "#94E2D5", "#89B4FA", "#F5C2E7", "#1F5C4D", "#8839EF"), { acc }, { acc = it }, true)

    // 3. see-through
    label(col, getString(R.string.qm_w_opacity))
    val pct = TextView(this)
    pct.setTextColor(muted)
    pct.text = "$opacity%"
    val bar = SeekBar(this)
    bar.max = 100
    bar.progress = opacity
    bar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
      override fun onProgressChanged(s: SeekBar?, p: Int, fromUser: Boolean) { opacity = p; pct.text = "$p%" }
      override fun onStartTrackingTouch(s: SeekBar?) {}
      override fun onStopTrackingTouch(s: SeekBar?) {}
    })
    col.addView(bar)
    col.addView(pct)

    // 4. text, corners, finished tasks
    label(col, getString(R.string.qm_w_text))
    chips(col, listOf(getString(R.string.qm_w_small), getString(R.string.qm_w_normal), getString(R.string.qm_w_large)), { text }, { text = it })
    label(col, getString(R.string.qm_w_corners))
    chips(col, listOf(getString(R.string.qm_w_square), getString(R.string.qm_w_rounded), getString(R.string.qm_w_round)), { corners }, { corners = it })
    label(col, getString(R.string.qm_w_hide_done))
    chips(col, listOf(getString(R.string.qm_w_show), getString(R.string.qm_w_hide)), { if (hideDone) 1 else 0 }, { hideDone = it == 1 })

    val save = TextView(this)
    save.text = getString(R.string.qm_w_save)
    save.gravity = Gravity.CENTER
    save.setTextColor(Color.parseColor("#1E1E2E"))
    save.textSize = 16f
    save.background = shape(accent, 26)
    save.setOnClickListener {
      if (titles.isNotEmpty()) QmPrefs.select(this, wid, sel)
      QmPrefs.saveStyle(this, wid, WidgetStyle(mode, acc, bg, opacity, text, corners, hideDone))
      ChecklistWidget.refreshAll(this)
      setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, wid))
      finish()
    }
    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, px(52))
    lp.setMargins(0, px(24), 0, px(8))
    col.addView(save, lp)

    val scroll = ScrollView(this)
    scroll.setBackgroundColor(Color.parseColor("#1E1E2E"))
    scroll.isFillViewport = true
    scroll.addView(col)
    setContentView(scroll)
  }
}

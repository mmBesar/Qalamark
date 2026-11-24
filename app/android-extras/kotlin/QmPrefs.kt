package io.github.mmbesar.qalamark

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** What the home-screen widget and the web app hand to each other (kept in one small preferences file). */
object QmPrefs {
  /** The page, so the widget can wake it the moment something is ticked (nothing polls). */
  @Volatile var web: android.webkit.WebView? = null

  fun poke() {
    val w = web ?: return
    w.post { w.evaluateJavascript("window.__qmTicks && window.__qmTicks()", null) }
  }

  private fun sp(c: Context) = c.getSharedPreferences("qalamark_widget", Context.MODE_PRIVATE)

  fun lists(c: Context): JSONArray = try { JSONArray(sp(c).getString("lists", "[]")) } catch (e: Exception) { JSONArray() }

  /** Which list a widget shows is remembered by the note's id (the order of the lists changes), with the first one as the start. */
  fun selected(c: Context, widgetId: Int): Int {
    val id = sp(c).getString("note_$widgetId", null) ?: return 0
    val l = lists(c)
    for (i in 0 until l.length()) if (l.getJSONObject(i).getString("id") == id) return i
    return 0
  }
  fun select(c: Context, widgetId: Int, index: Int) {
    val l = lists(c)
    if (index < 0 || index >= l.length()) return
    sp(c).edit().putString("note_$widgetId", l.getJSONObject(index).getString("id")).apply()
  }
  fun forget(c: Context, widgetId: Int) { sp(c).edit().remove("note_$widgetId").apply() }

  private fun pending(c: Context): JSONArray = try { JSONArray(sp(c).getString("ticks", "[]")) } catch (e: Exception) { JSONArray() }

  /** A snapshot of the checklists from the app. Ticks not yet applied by the app are shown on top, so nothing jumps back. */
  @Synchronized fun setLists(c: Context, json: String) {
    val lists = try { JSONArray(json) } catch (e: Exception) { return }
    val p = pending(c)
    for (i in 0 until p.length()) {
      val t = p.getJSONObject(i)
      flip(lists, t.getString("id"), t.getInt("line"))
    }
    sp(c).edit().putString("lists", lists.toString()).apply()
  }

  /** The person ticked (or unticked) a task on the home screen. */
  @Synchronized fun tick(c: Context, id: String, line: Int) {
    val lists = lists(c)
    flip(lists, id, line)
    val p = pending(c)
    p.put(JSONObject().put("id", id).put("line", line))
    sp(c).edit().putString("lists", lists.toString()).putString("ticks", p.toString()).apply()
  }

  @Synchronized fun pushTick(c: Context, json: String) {
    val p = pending(c)
    try { p.put(JSONObject(json)) } catch (e: Exception) { return }
    sp(c).edit().putString("ticks", p.toString()).apply()
  }

  @Synchronized fun takeTicks(c: Context): String {
    val s = sp(c).getString("ticks", "[]") ?: "[]"
    sp(c).edit().putString("ticks", "[]").apply()
    return s
  }

  /** Flip one task and everything under it (the tasks after it that are indented deeper). */
  private fun flip(lists: JSONArray, id: String, line: Int) {
    for (i in 0 until lists.length()) {
      val l = lists.getJSONObject(i)
      if (l.getString("id") != id) continue
      val items = l.getJSONArray("items")
      for (k in 0 until items.length()) {
        val it = items.getJSONObject(k)
        if (it.optBoolean("head", false) || it.getInt("line") != line) continue
        val now = !it.getBoolean("done")
        val depth = it.getInt("depth")
        it.put("done", now)
        var j = k + 1
        while (j < items.length() && !items.getJSONObject(j).optBoolean("head", false) && items.getJSONObject(j).getInt("depth") > depth) {
          items.getJSONObject(j).put("done", now)
          j++
        }
        return
      }
    }
  }
}

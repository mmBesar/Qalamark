package io.github.mmbesar.qalamark

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build

/** How one widget looks: remembered per widget, turned into real colours when it is drawn. */
class WidgetStyle(
  val mode: String,       // app | dark | light | system | custom
  val accent: String,     // "" = the scheme's own, or #RRGGBB
  val bg: String,         // custom background, #RRGGBB
  val opacity: Int,       // 0..100
  val text: Int,          // 0 small, 1 normal, 2 large
  val corners: Int,       // 0 square, 1 rounded, 2 round
  val hideDone: Boolean,
) {
  class Colors(val bg: Int, val ink: Int, val muted: Int, val accent: Int, val onAccent: Int)

  val scale: Float get() = when (text) { 0 -> 0.88f; 2 -> 1.18f; else -> 1f }
  val alpha: Int get() = (opacity.coerceIn(0, 100) * 255 / 100)

  fun colors(c: Context): Colors {
    val base: Colors = when (mode) {
      "dark" -> Colors(0xFF1E1E2E.toInt(), 0xFFCDD6F4.toInt(), 0xFF9399B2.toInt(), 0xFFCBA6F7.toInt(), 0xFF1E1E2E.toInt())
      "light" -> Colors(0xFFEFF1F5.toInt(), 0xFF4C4F69.toInt(), 0xFF7C7F93.toInt(), 0xFF8839EF.toInt(), 0xFFEFF1F5.toInt())
      "system" -> system(c) ?: QmPrefs.appColors(c)
      "custom" -> {
        val b = parse(bg, 0xFF1E1E2E.toInt())
        val dark = lum(b) < 0.5f
        val ink = if (dark) 0xFFF2F2F7.toInt() else 0xFF1B1B22.toInt()
        Colors(b, ink, mix(ink, b, 0.62f), if (dark) 0xFFCBA6F7.toInt() else 0xFF8839EF.toInt(), b)
      }
      else -> QmPrefs.appColors(c)
    }
    val a = if (accent.isNotEmpty()) parse(accent, base.accent) else base.accent
    return Colors(base.bg, base.ink, base.muted, a, if (lum(a) > 0.55f) 0xFF1B1B22.toInt() else 0xFFFFFFFF.toInt())
  }

  private fun system(c: Context): Colors? {
    if (Build.VERSION.SDK_INT < 31) return null
    val night = (c.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    return try {
      if (night) Colors(c.getColor(android.R.color.system_neutral1_900), c.getColor(android.R.color.system_neutral1_100), c.getColor(android.R.color.system_neutral2_300), c.getColor(android.R.color.system_accent1_200), c.getColor(android.R.color.system_accent1_900))
      else Colors(c.getColor(android.R.color.system_neutral1_10), c.getColor(android.R.color.system_neutral1_900), c.getColor(android.R.color.system_neutral2_600), c.getColor(android.R.color.system_accent1_600), c.getColor(android.R.color.system_accent1_0))
    } catch (e: Exception) { null }
  }

  companion object {
    val DEFAULT = WidgetStyle("app", "", "#1E1E2E", 94, 1, 2, false)

    fun parse(s: String, fallback: Int): Int = try { Color.parseColor(if (s.startsWith("#")) s else "#$s") or 0xFF000000.toInt() } catch (e: Exception) { fallback }
    fun hex(c: Int): String = String.format("#%06X", c and 0xFFFFFF)
    fun lum(c: Int): Float = (0.2126f * Color.red(c) + 0.7152f * Color.green(c) + 0.0722f * Color.blue(c)) / 255f
    fun mix(a: Int, b: Int, k: Float): Int = Color.rgb(
      (Color.red(a) * k + Color.red(b) * (1 - k)).toInt(),
      (Color.green(a) * k + Color.green(b) * (1 - k)).toInt(),
      (Color.blue(a) * k + Color.blue(b) * (1 - k)).toInt(),
    )
  }
}

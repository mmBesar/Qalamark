package io.github.mmbesar.qalamark

import android.app.Activity
import android.content.Context
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient

/** "Export as PDF": the page is laid out by a hidden web view and handed to the system print window (it can save a PDF). */
object PrintPage {
  // the web view must stay alive until the print window has read it
  private var current: WebView? = null

  fun print(activity: Activity, html: String, name: String) {
    activity.runOnUiThread {
      val wv = WebView(activity)
      current = wv
      wv.settings.javaScriptEnabled = false
      wv.webViewClient = object : WebViewClient() {
        override fun onPageFinished(view: WebView, url: String?) {
          val pm = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
          val attrs = PrintAttributes.Builder().setMinMargins(PrintAttributes.Margins.NO_MARGINS).build()
          pm.print(name, view.createPrintDocumentAdapter(name), attrs)
        }
      }
      wv.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }
  }
}

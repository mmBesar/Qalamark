# Adds the home-screen widget and the background service to the generated Android manifest (safe to run twice).
import sys

p = sys.argv[1]
s = open(p).read()
extra = """
    <receiver android:name="io.github.mmbesar.qalamark.ChecklistWidget" android:exported="false" android:label="@string/qm_widget_name">
      <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE" /></intent-filter>
      <meta-data android:name="android.appwidget.provider" android:resource="@xml/qm_checklist_widget" />
    </receiver>
    <activity android:name="io.github.mmbesar.qalamark.WidgetConfigActivity" android:exported="true" android:theme="@android:style/Theme.DeviceDefault.Dialog.NoActionBar" android:excludeFromRecents="true">
      <intent-filter><action android:name="android.appwidget.action.APPWIDGET_CONFIGURE" /></intent-filter>
    </activity>
    <service android:name="io.github.mmbesar.qalamark.ChecklistService" android:permission="android.permission.BIND_REMOTEVIEWS" android:exported="false" />
    <service android:name="io.github.mmbesar.qalamark.KeepAliveService" android:exported="false" android:foregroundServiceType="specialUse">
      <property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="Keeps the person's notes in sync while the app is in the background" />
    </service>
"""
if "ChecklistWidget" not in s:
    s = s.replace("</application>", extra + "  </application>", 1)
open(p, "w").write(s)

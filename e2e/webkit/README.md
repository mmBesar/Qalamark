# Real-WebKitGTK harness

Chromium cannot show WebKitGTK-only text bugs (Arabic marks shifted in the Linux app). This runs the built web app in
WebKitGTK's MiniBrowser under Xvfb and takes a screenshot.

    # needs: webkit2gtk MiniBrowser + WebKitWebDriver, xvfb, python3 selenium + pillow
    QALAMARK_DATA=/tmp/dd QALAMARK_ADDR=127.0.0.1:34610 QALAMARK_WEB=app/dist server/target/debug/qalamark-server &
    cd e2e/webkit
    TEXT="$(cat text.txt)" SETTINGS='{"fontAr":"Noto Naskh Arabic"}' [CSS=… JS=… PROBE=probe.js] \
      xvfb-run -a -s "-screen 0 1300x900x24" python3 app.py out.png

Kill stale `MiniBrowser` / `WebKitWebDriver` processes first. Crop and zoom the PNG to judge marks by eye.

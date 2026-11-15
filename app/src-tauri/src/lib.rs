// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The native shell is intentionally thin: it shows the same web app as the browser.
// The app talks to the user's own Qalamark server (address set on the sign-in screen),
// or works fully offline with notes kept on the device.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Qalamark");
}

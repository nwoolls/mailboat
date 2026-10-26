//! The Dock icon: the app icon chosen in Settings, or the built-in one.
//!
//! With no choice, macOS draws the built-in icon (the Icon Composer icon in
//! `macos/Assets.car`, with its glass rim). Dev builds launch from a real
//! `Mailboat.app` (`scripts/dev-run.sh`) for that, but Tauri paints its flat
//! embedded icon over it when the app is ready (after MonoCode's
//! `prefer_bundle_dock_icon`), so dev builds clear that again.

/// At launch: the chosen icon (`png`), or the built-in one. Set now and
/// again shortly after, in case Tauri sets its own once more after `Ready`.
#[cfg(target_os = "macos")]
pub fn show_at_launch(png: Option<&'static [u8]>) {
    use objc2::{msg_send, sel, MainThreadMarker};
    use objc2_app_kit::NSApplication;

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    // Release builds already show the built-in icon; leave them be.
    if png.is_none() && !(cfg!(debug_assertions) && bundled()) {
        return;
    }
    let image = png.and_then(image_from);
    let app = NSApplication::sharedApplication(mtm);
    unsafe { app.setApplicationIconImage(image.as_deref()) };
    app.dockTile().display();
    unsafe {
        let _: () = msg_send![
            &app,
            performSelector: sel!(setApplicationIconImage:),
            withObject: image.as_deref(),
            afterDelay: 0.3_f64
        ];
    }
}

/// After a change in Settings: show the chosen icon, or hand the Dock back
/// to the built-in one.
#[cfg(target_os = "macos")]
pub fn set_icon(app: &tauri::AppHandle, png: Option<&'static [u8]>) {
    let _ = app.run_on_main_thread(move || {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSApplication;

        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        // A bare dev binary has no built-in icon to go back to; clearing
        // would leave the generic one, so keep Tauri's.
        if png.is_none() && !bundled() {
            return;
        }
        let image = png.and_then(image_from);
        let app = NSApplication::sharedApplication(mtm);
        unsafe { app.setApplicationIconImage(image.as_deref()) };
        app.dockTile().display();
    });
}

#[cfg(target_os = "macos")]
fn image_from(png: &[u8]) -> Option<objc2::rc::Retained<objc2_app_kit::NSImage>> {
    use objc2::AllocAnyThread;
    use objc2_app_kit::NSImage;
    use objc2_foundation::NSData;

    NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(png))
}

/// Running from a `.app` (always, except a bare `cargo run`).
#[cfg(target_os = "macos")]
fn bundled() -> bool {
    std::env::current_exe()
        .ok()
        .is_some_and(|exe| exe.to_string_lossy().contains(".app/Contents/MacOS/"))
}

#[cfg(not(target_os = "macos"))]
pub fn show_at_launch(_png: Option<&'static [u8]>) {}

#[cfg(not(target_os = "macos"))]
pub fn set_icon(_app: &tauri::AppHandle, _png: Option<&'static [u8]>) {}

//! The Dock icon in dev builds (after MonoCode's `prefer_bundle_dock_icon`).
//!
//! `scripts/dev-run.sh` launches dev builds from a real `Mailboat.app`, so
//! macOS draws the Icon Composer icon (`macos/Assets.car`) with its glass
//! rim. But in dev, Tauri paints the flat embedded icon onto the Dock when
//! the app is ready, covering it. Clearing that image hands the Dock back to
//! macOS. Release builds are real bundles and Tauri leaves them alone.

/// Clears Tauri's dev Dock image, now and again shortly after, in case
/// Tauri sets it once more after `Ready`. Only when running from a `.app`;
/// a bare binary would be left with the generic icon instead.
#[cfg(all(debug_assertions, target_os = "macos"))]
pub fn prefer_bundle_icon() {
    use objc2::{msg_send, sel, MainThreadMarker};
    use objc2_app_kit::NSApplication;

    let bundled = std::env::current_exe()
        .ok()
        .is_some_and(|exe| exe.to_string_lossy().contains(".app/Contents/MacOS/"));
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    if !bundled {
        return;
    }
    let app = NSApplication::sharedApplication(mtm);
    unsafe { app.setApplicationIconImage(None) };
    app.dockTile().display();
    unsafe {
        let _: () = msg_send![
            &app,
            performSelector: sel!(setApplicationIconImage:),
            withObject: None::<&objc2::runtime::AnyObject>,
            afterDelay: 0.3_f64
        ];
    }
}

#[cfg(not(all(debug_assertions, target_os = "macos")))]
pub fn prefer_bundle_icon() {}

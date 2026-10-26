//! The Dock icon (Windows: the window's icon in the taskbar): the app icon
//! chosen in Settings, or the built-in one.
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

/// Windows: the chosen icon goes on the window, which the taskbar shows
/// while Mailboat runs (Windows doesn't let an app change its pinned
/// shortcut or Start menu icon, which keep `icon.ico`). With no choice,
/// back to the built-in icon. Also called at launch.
#[cfg(not(target_os = "macos"))]
pub fn set_icon(app: &tauri::AppHandle, png: Option<&'static [u8]>) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let icon = match png.and_then(filled) {
        Some(icon) => icon,
        None => match app.default_window_icon() {
            Some(icon) => icon.clone(),
            None => return,
        },
    };
    let _ = window.set_icon(icon);
}

/// The choices are Mac art: the tile sits inside Apple's margin (100 of
/// every 1024 px each side). Windows draws icons edge to edge, so they're
/// cropped to the tile plus a hair (92 of 1024), as `icon.ico` is
/// (`design/icon/mailboat-icon-windows.svg`). `None` if it isn't 8-bit RGBA.
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn filled(png: &[u8]) -> Option<tauri::image::Image<'static>> {
    let mut reader = png::Decoder::new(std::io::Cursor::new(png))
        .read_info()
        .ok()?;
    let mut rgba = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut rgba).ok()?;
    if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
        return None;
    }
    let (size, side) = (info.width as usize, info.height as usize);
    if size != side {
        return None;
    }
    let margin = size * 92 / 1024;
    let out = size - 2 * margin;
    let mut cropped = Vec::with_capacity(out * out * 4);
    for row in rgba.chunks_exact(size * 4).skip(margin).take(out) {
        cropped.extend_from_slice(&row[margin * 4..(margin + out) * 4]);
    }
    Some(tauri::image::Image::new_owned(
        cropped, out as u32, out as u32,
    ))
}

#[cfg(test)]
mod tests {
    #[test]
    fn choices_are_cropped_to_fill_the_square() {
        let png = crate::app_icon::png(Some("C17-system-blue")).expect("a choice");
        let icon = super::filled(png).expect("decodes");
        // 512 px with 46 px cut from each side.
        assert_eq!((icon.width(), icon.height()), (420, 420));
        // The tile starts 4 px in (50 of 512 in the Mac art, a few px
        // inside where the margin was): row 8, mid-width, is opaque.
        let alpha = |row: usize| icon.rgba()[(row * 420 + 210) * 4 + 3];
        assert!(alpha(8) > 200, "tile near the edge");
        // Above it, only the faint edge of the Mac art's drop shadow.
        assert!(alpha(0) < 40, "only a hair of margin left");
    }
}

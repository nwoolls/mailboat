//! When fingers touch and leave the trackpad, for swipes on the list's
//! rows. Browsers don't report the lift (wheel events just stop, the same
//! as fingers held still), so the web side couldn't tell "let go" from
//! "holding": an armed swipe acted while still held. macOS knows: each
//! scroll event carries a phase. A local monitor (this app's events only,
//! passed on untouched) reads it and tells the window.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;
use tauri_specta::Event;

/// Fingers touched (`true`) or left (`false`) the trackpad while
/// scrolling. Never sent for a mouse wheel, which has no phases.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct TrackpadEvent {
    pub touching: bool,
}

#[cfg(target_os = "macos")]
pub fn watch(app: &AppHandle) {
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventPhase};

    let app = app.clone();
    let handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        // SAFETY: AppKit hands the monitor a valid event for this call.
        let phase = unsafe { event.as_ref() }.phase();
        let touching = if phase.contains(NSEventPhase::Began) {
            Some(true)
        } else if phase.contains(NSEventPhase::Ended) || phase.contains(NSEventPhase::Cancelled) {
            Some(false)
        } else {
            None
        };
        if let Some(touching) = touching {
            let _ = TrackpadEvent { touching }.emit(&app);
        }
        // Passed on unchanged: the page still gets its wheel events.
        event.as_ptr()
    });
    // SAFETY: the handler returns the event it was given. The monitor
    // lives as long as the app, so it's never removed.
    let monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::ScrollWheel, &handler)
    };
    std::mem::forget(monitor);
}

#[cfg(not(target_os = "macos"))]
pub fn watch(_app: &AppHandle) {}

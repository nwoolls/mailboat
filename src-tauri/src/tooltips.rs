//! Native tooltips on any desktop. The page's tooltips are its `title`
//! attributes, which macOS draws in a small window of its own
//! (`NSToolTipPanel`, made by AppKit in the app's process). AppKit makes that
//! window once and reuses it. When the app is assigned to one desktop (Dock
//! → Options → Assign To → This Desktop), the window opens on the assigned
//! desktop even when the app's window is on another, so no tooltip shows
//! there. Told to move to the desktop in use whenever it shows, it appears
//! beside the pointer on any desktop.
//!
//! The setting is made the first time the tooltip window's visibility
//! changes. Without it, a reused tooltip window opening on the hidden
//! desktop reports no change on the desktop in use, so nothing would catch
//! it; but the window reports one when it is first made, so the first
//! tooltip after launch is caught too (checked in demo mode, 2026-11-22,
//! with the window moved off the assigned desktop before any tooltip had
//! shown). Once set, the setting stays with the window.

/// Watches every window's visibility (occlusion) changes, and sets the
/// tooltip window, picked out by its class, to follow the desktop in use.
#[cfg(target_os = "macos")]
pub fn follow_desktop() {
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSWindow, NSWindowCollectionBehavior, NSWindowDidChangeOcclusionStateNotification,
    };
    use objc2_foundation::{NSNotification, NSNotificationCenter};

    if MainThreadMarker::new().is_none() {
        return;
    }
    // Captures nothing, so it's safe to keep for the app's life.
    let block = RcBlock::new(|note: NonNull<NSNotification>| {
        // AppKit posts this on the main thread; anything else that posts the
        // same name elsewhere is ignored.
        if MainThreadMarker::new().is_none() {
            return;
        }
        // SAFETY: AppKit hands the observer a valid notification for this
        // call.
        let Some(object) = (unsafe { note.as_ref() }).object() else {
            return;
        };
        // AppKit's own class, not public API: on a macOS that names it
        // otherwise, nothing changes and tooltips behave as before.
        if object.class().name().to_bytes() != b"NSToolTipPanel" {
            return;
        }
        let Some(window) = object.downcast_ref::<NSWindow>() else {
            return;
        };
        // Moves to the desktop in use when shown; like a menu, it isn't
        // one of the windows Mission Control and window cycling show. Added
        // to what the window has (nothing, on the macOS it was checked on),
        // less the choices AppKit doesn't allow beside these: being on every
        // desktop, and the other Mission Control kinds.
        let now = window.collectionBehavior();
        let want = (now
            - (NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Managed
                | NSWindowCollectionBehavior::Stationary))
            | NSWindowCollectionBehavior::MoveToActiveSpace
            | NSWindowCollectionBehavior::Transient
            | NSWindowCollectionBehavior::IgnoresCycle;
        if now != want {
            window.setCollectionBehavior(want);
        }
    });
    let center = NSNotificationCenter::defaultCenter();
    // SAFETY: the name is AppKit's constant, any window may post it (no
    // object filter), and with no queue the block runs on the posting
    // thread, which for window notifications is the main thread. The
    // observer lives as long as the app, so it's never removed.
    let observer = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(NSWindowDidChangeOcclusionStateNotification),
            None,
            None,
            &block,
        )
    };
    std::mem::forget(observer);
}

#[cfg(not(target_os = "macos"))]
pub fn follow_desktop() {}

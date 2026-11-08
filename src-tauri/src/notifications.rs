//! New-mail notifications. On macOS they go through the system's own
//! notification center (`UNUserNotificationCenter`) rather than the
//! notification plugin, because only that tells the app when one is clicked:
//! the click then opens its conversation (`NotificationOpenedEvent`).
//! Elsewhere, and when the app isn't running from an app bundle (macOS
//! refuses the notification center then), the plugin shows them as before.

use mail_core::mail::notify::Notice;
use mail_core::model::ThreadId;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;
use tauri_specta::Event;

/// A new-mail notification was clicked: show this conversation (`None`:
/// the "N new messages" summary, which only brings the app forward).
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct NotificationOpenedEvent {
    pub thread_id: Option<ThreadId>,
}

/// Each notification's identifier carries its conversation, so a click
/// can find it again: `thread:<n>:<thread id or "-">`. macOS only: the
/// notification plugin used elsewhere can't report clicks.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn identifier(seq: u64, thread: Option<ThreadId>) -> String {
    let thread = thread.map_or("-".to_string(), |t| t.0.to_string());
    format!("thread:{seq}:{thread}")
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn thread_of(identifier: &str) -> Option<ThreadId> {
    let mut parts = identifier.split(':');
    (parts.next() == Some("thread"))
        .then(|| parts.nth(1)?.parse().ok().map(ThreadId))
        .flatten()
}

/// Sets up click handling and asks macOS for permission (it asks the
/// person once). Call at startup.
pub fn install(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    mac::install(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Removes the notifications already delivered (and any waiting): they can
/// hold senders, subjects and sign-in codes. macOS only; the Windows
/// plugin has no way to take back a toast.
pub fn clear_all() {
    #[cfg(target_os = "macos")]
    if mac::available() {
        mac::clear_all();
    }
}

/// Shows these notifications.
pub fn show(app: &AppHandle, notices: Vec<Notice>) {
    #[cfg(target_os = "macos")]
    if mac::available() {
        for n in notices {
            mac::show(&n);
        }
        return;
    }
    use tauri_plugin_notification::NotificationExt;
    for n in notices {
        let _ = app
            .notification()
            .builder()
            .title(n.title)
            .body(n.body)
            .show();
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::OnceLock;

    use block2::{DynBlock, RcBlock};
    use mail_core::mail::notify::Notice;
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{define_class, msg_send, ClassType};
    use objc2_foundation::{NSBundle, NSError, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNMutableNotificationContent, UNNotification,
        UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
        UNNotificationSound, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
    };
    use tauri::{AppHandle, Manager};
    use tauri_specta::Event;

    use super::{identifier, thread_of, NotificationOpenedEvent};

    /// For the delegate, which macOS calls with no way to pass state.
    static APP: OnceLock<AppHandle> = OnceLock::new();
    static SEQ: AtomicU64 = AtomicU64::new(0);

    define_class!(
        // SAFETY: NSObject has no subclassing requirements, and the class
        // keeps no state of its own.
        #[unsafe(super(NSObject))]
        #[name = "AppNotificationDelegate"]
        struct Delegate;

        unsafe impl NSObjectProtocol for Delegate {}

        unsafe impl UNUserNotificationCenterDelegate for Delegate {
            /// Show it even while the app is in front, as Mail does.
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                done: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                done.call((UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List
                    | UNNotificationPresentationOptions::Sound,));
            }

            /// Clicked: bring the app forward and open the conversation.
            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive(
                &self,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                done: &DynBlock<dyn Fn()>,
            ) {
                let id = response.notification().request().identifier().to_string();
                if let Some(app) = APP.get() {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    let _ = NotificationOpenedEvent {
                        thread_id: thread_of(&id),
                    }
                    .emit(app);
                }
                done.call(());
            }
        }
    );

    /// macOS only allows the notification center to apps in a bundle (it
    /// throws otherwise); the dev build is wrapped in one by
    /// `scripts/dev-run.sh`, a bare `cargo run` isn't.
    pub fn available() -> bool {
        let bundle = NSBundle::mainBundle();
        bundle.bundleIdentifier().is_some() && bundle.bundlePath().to_string().ends_with(".app")
    }

    pub fn install(app: &AppHandle) {
        if !available() {
            return;
        }
        let _ = APP.set(app.clone());
        let center = UNUserNotificationCenter::currentNotificationCenter();
        // SAFETY: `new` on an NSObject subclass with no ivars.
        let delegate: Retained<Delegate> = unsafe { msg_send![Delegate::class(), new] };
        center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        // The center holds its delegate weakly; this one lives as long as
        // the app.
        std::mem::forget(delegate);
        let asked = RcBlock::new(|_granted: Bool, _error: *mut NSError| {});
        center.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &asked,
        );
    }

    pub fn clear_all() {
        let center = UNUserNotificationCenter::currentNotificationCenter();
        center.removeAllDeliveredNotifications();
        center.removeAllPendingNotificationRequests();
    }

    pub fn show(notice: &Notice) {
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&notice.title));
        content.setBody(&NSString::from_str(&notice.body));
        content.setSound(Some(&UNNotificationSound::defaultSound()));
        let id = identifier(SEQ.fetch_add(1, Ordering::Relaxed), notice.thread);
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(&id),
            &content,
            None,
        );
        UNUserNotificationCenter::currentNotificationCenter()
            .addNotificationRequest_withCompletionHandler(&request, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_notification_remembers_its_conversation() {
        assert_eq!(
            thread_of(&identifier(3, Some(ThreadId(42)))),
            Some(ThreadId(42))
        );
        assert_eq!(thread_of(&identifier(4, None)), None);
        assert_eq!(thread_of("someone-else:1:42"), None);
    }
}

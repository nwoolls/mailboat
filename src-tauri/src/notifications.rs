//! New-mail notifications. On macOS they go through the system's own
//! notification center (`UNUserNotificationCenter`) rather than the
//! notification plugin, because only that tells the app when one is clicked:
//! the click then opens its conversation (`NotificationOpenedEvent`).
//! On Linux they go to the freedesktop notification service directly, over
//! one D-Bus connection, for the same reason: the plugin doesn't pass a
//! click on there either. Elsewhere (Windows), and
//! when the Mac app isn't running from an app bundle (macOS refuses the
//! notification center then), the plugin shows them.

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
    #[cfg(target_os = "linux")]
    linux::install(app);
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let _ = app;
}

/// Removes the notifications already delivered (and any waiting): they can
/// hold senders, subjects and sign-in codes. macOS and Linux; the Windows
/// plugin has no way to take back a toast.
pub fn clear_all() {
    #[cfg(target_os = "macos")]
    if mac::available() {
        mac::clear_all();
    }
    #[cfg(target_os = "linux")]
    linux::clear_all();
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
    #[cfg(target_os = "linux")]
    for n in notices {
        linux::show(app, n);
    }
    #[cfg(not(target_os = "linux"))]
    {
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

        // SAFETY: an NSObject subclass meets NSObjectProtocol.
        unsafe impl NSObjectProtocol for Delegate {}

        // SAFETY: the two methods below have the protocol's selectors and
        // argument types, and call each completion handler once, as the
        // protocol requires.
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

/// Linux's record of the notifications shown, apart from D-Bus so it is
/// tested on every system.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
mod linux_state {
    use std::collections::BTreeMap;

    use mail_core::model::ThreadId;

    /// How many shown notifications are remembered. A service that never
    /// says one was closed would otherwise grow the list for as long as
    /// the app runs; the oldest (lowest ID) is forgotten first.
    const REMEMBERED: usize = 256;

    /// The notifications shown, and the service that numbered them: its
    /// unique bus name. IDs mean something only to that service, so a
    /// signal from any other sender is ignored, and a new owner of the
    /// service's name (a restart, which numbers afresh) empties the list.
    #[derive(Default)]
    pub struct State {
        pub owner: Option<String>,
        pub shown: BTreeMap<u32, Option<ThreadId>>,
    }

    impl State {
        /// The service's name now belongs to `owner` (None: to no one).
        /// Only a change from the owner known, or to a new one, empties the
        /// list: a late notice about an earlier owner changes nothing.
        pub fn owner_changed(&mut self, old: Option<&str>, new: Option<&str>) {
            let about_ours = old.is_some() && old == self.owner.as_deref();
            let to_another = new.is_some() && new != self.owner.as_deref();
            if about_ours || to_another {
                self.owner = new.map(str::to_string);
                self.shown.clear();
            }
        }

        /// A notification the service `owner` numbered `id`.
        pub fn posted(&mut self, owner: &str, id: u32, thread: Option<ThreadId>) {
            if self.owner.as_deref() != Some(owner) {
                self.owner = Some(owner.to_string());
                self.shown.clear();
            }
            self.shown.insert(id, thread);
            while self.shown.len() > REMEMBERED {
                self.shown.pop_first();
            }
        }
    }

    #[cfg(test)]
    mod state_tests {
        use super::State;
        use mail_core::model::ThreadId;

        #[test]
        fn a_late_notice_about_an_earlier_owner_keeps_the_new_ones() {
            let mut s = State::default();
            s.posted(":1.10", 1, Some(ThreadId(42)));
            // The service restarts as :1.20, and the app posts to it first.
            s.posted(":1.20", 1, Some(ThreadId(7)));
            assert_eq!(s.shown.get(&1), Some(&Some(ThreadId(7))));
            // Then the bus's notices arrive: the old owner left, the new came.
            s.owner_changed(Some(":1.10"), None);
            s.owner_changed(None, Some(":1.20"));
            assert_eq!(s.shown.get(&1), Some(&Some(ThreadId(7))));
            // The current owner leaving empties the list.
            s.owner_changed(Some(":1.20"), None);
            assert!(s.shown.is_empty() && s.owner.is_none());
        }

        #[test]
        fn a_new_owner_empties_the_list_and_the_list_has_a_limit() {
            let mut s = State::default();
            for id in 1..=300 {
                s.posted(":1.10", id, None);
            }
            assert_eq!(s.shown.len(), 256);
            assert_eq!(s.shown.keys().next(), Some(&45));
            s.owner_changed(Some(":1.10"), Some(":1.30"));
            assert!(s.shown.is_empty());
            assert_eq!(s.owner.as_deref(), Some(":1.30"));
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use mail_core::mail::notify::Notice;
    use mail_core::model::ThreadId;
    use tauri::{AppHandle, Manager};
    use tauri_specta::Event;
    use zbus::blocking::{Connection, MessageIterator};
    use zbus::message::Type;
    use zbus::zvariant::Value;
    use zbus::MatchRule;

    use super::linux_state::State;
    use super::NotificationOpenedEvent;

    const NAME: &str = "org.freedesktop.Notifications";
    const PATH: &str = "/org/freedesktop/Notifications";

    /// How long a call to the service may take: one that stops answering
    /// must not hold up the app.
    pub const CALL_TIMEOUT: Duration = Duration::from_secs(5);

    /// How long taking them all back may take, together.
    pub const CLEAR_DEADLINE: Duration = Duration::from_secs(10);

    /// One connection to the notification service, for everything: a
    /// service may take a close only from the connection that posted the
    /// notification (GNOME checks). Clicks and closes are read in the
    /// order the service sent them, by one listener subscribed before
    /// anything is posted, and no lock is held during a call.
    pub struct Service {
        connection: Connection,
        state: Mutex<State>,
        /// False once the connection is gone: the next `show` connects
        /// again.
        alive: AtomicBool,
    }

    /// A call that took longer than `CALL_TIMEOUT`, as opposed to a lost
    /// connection.
    fn timed_out(e: &zbus::Error) -> bool {
        matches!(e, zbus::Error::InputOutput(io) if io.kind() == std::io::ErrorKind::TimedOut)
    }

    impl Service {
        /// Starts listening on `connection` (built with `CALL_TIMEOUT`):
        /// `on_click` gets the conversation of a notification of this
        /// app's that was clicked (the "default" action, which GNOME, KDE
        /// and most others send for a click on it).
        pub fn connect(
            connection: Connection,
            on_click: impl Fn(Option<ThreadId>) + Send + 'static,
        ) -> zbus::Result<Arc<Service>> {
            let signals = MessageIterator::for_match_rule(
                MatchRule::builder()
                    .msg_type(Type::Signal)
                    .interface(NAME)?
                    .path(PATH)?
                    .build(),
                &connection,
                None,
            )?;
            let owners = MessageIterator::for_match_rule(
                MatchRule::builder()
                    .msg_type(Type::Signal)
                    .sender("org.freedesktop.DBus")?
                    .interface("org.freedesktop.DBus")?
                    .member("NameOwnerChanged")?
                    .arg(0, NAME)?
                    .build(),
                &connection,
                None,
            )?;
            let service = Arc::new(Service {
                connection,
                state: Mutex::new(State::default()),
                alive: AtomicBool::new(true),
            });
            let listening = Arc::clone(&service);
            std::thread::spawn(move || {
                for message in signals {
                    let Ok(message) = message else { break };
                    let header = message.header();
                    let sender = header.sender().map(|s| s.to_string());
                    let member = header.member().map(|m| m.to_string());
                    let mut state = listening.state.lock().unwrap();
                    if sender.is_none() || sender != state.owner {
                        continue;
                    }
                    match member.as_deref() {
                        Some("ActionInvoked") => {
                            let Ok((id, action)) = message.body().deserialize::<(u32, String)>()
                            else {
                                continue;
                            };
                            let thread = match state.shown.get(&id) {
                                Some(thread) if action == "default" => *thread,
                                // Another app's, or another of its actions.
                                _ => continue,
                            };
                            drop(state);
                            on_click(thread);
                        }
                        Some("NotificationClosed") => {
                            if let Ok((id, _reason)) = message.body().deserialize::<(u32, u32)>() {
                                state.shown.remove(&id);
                            }
                        }
                        _ => {}
                    }
                }
                listening.alive.store(false, Ordering::Release);
            });
            let listening = Arc::clone(&service);
            std::thread::spawn(move || {
                for message in owners {
                    let Ok(message) = message else { break };
                    let Ok((_, old, new)) =
                        message.body().deserialize::<(String, String, String)>()
                    else {
                        continue;
                    };
                    let some = |s: &str| (!s.is_empty()).then(|| s.to_string());
                    let (old, new) = (some(&old), some(&new));
                    listening
                        .state
                        .lock()
                        .unwrap()
                        .owner_changed(old.as_deref(), new.as_deref());
                }
                listening.alive.store(false, Ordering::Release);
            });
            Ok(service)
        }

        pub fn alive(&self) -> bool {
            self.alive.load(Ordering::Acquire)
        }

        /// Closes the connection, which ends both listeners (so the threads
        /// and the service go), and marks it dead.
        fn retire(&self) {
            self.alive.store(false, Ordering::Release);
            let _ = self.connection.clone().close();
        }

        /// Posts one, with a "default" action so a click can open it. A
        /// call that timed out leaves the connection as it is; a lost one is
        /// closed, so the next notification connects again.
        pub fn post(&self, notice: &Notice) {
            let mut hints: std::collections::HashMap<&str, Value> =
                std::collections::HashMap::new();
            hints.insert("desktop-entry", Value::from(mail_core::brand::NAME));
            let reply = self.connection.call_method(
                Some(NAME),
                PATH,
                Some(NAME),
                "Notify",
                &(
                    mail_core::brand::NAME,
                    0u32,
                    mail_core::brand::SHORT_NAME,
                    notice.title.as_str(),
                    notice.body.as_str(),
                    vec!["default", "Open"],
                    hints,
                    -1i32,
                ),
            );
            match reply {
                Ok(reply) => {
                    let header = reply.header();
                    let (Some(owner), Ok(id)) =
                        (header.sender(), reply.body().deserialize::<u32>())
                    else {
                        return;
                    };
                    let owner = owner.to_string();
                    self.state.lock().unwrap().posted(&owner, id, notice.thread);
                }
                Err(zbus::Error::MethodError(..)) => {}
                Err(e) if timed_out(&e) => {}
                Err(_) => self.retire(),
            }
        }

        /// Takes back every notification still shown, from the service that
        /// numbered them, without holding the list during the calls, within
        /// `CLEAR_DEADLINE` in all. One the service refused stays listed for
        /// the next try; a call that timed out ends the round.
        pub fn clear_all(&self) {
            let (owner, ids) = {
                let state = self.state.lock().unwrap();
                (
                    state.owner.clone(),
                    state.shown.keys().copied().collect::<Vec<_>>(),
                )
            };
            let Some(owner) = owner else { return };
            let started = Instant::now();
            for id in ids {
                if started.elapsed() > CLEAR_DEADLINE {
                    break;
                }
                let closed = self.connection.call_method(
                    Some(owner.as_str()),
                    PATH,
                    Some(NAME),
                    "CloseNotification",
                    &(id,),
                );
                match closed {
                    Ok(_) => {
                        let mut state = self.state.lock().unwrap();
                        if state.owner.as_deref() == Some(owner.as_str()) {
                            state.shown.remove(&id);
                        }
                    }
                    Err(e) if timed_out(&e) => break,
                    Err(zbus::Error::MethodError(..)) => {}
                    Err(_) => {
                        self.retire();
                        break;
                    }
                }
            }
        }

        #[cfg(test)]
        pub fn shown(&self) -> Vec<u32> {
            self.state.lock().unwrap().shown.keys().copied().collect()
        }
    }

    /// The service in use; empty before the first notification, after a
    /// session bus that couldn't be reached, or once the connection died.
    static SERVICE: Mutex<Option<Arc<Service>>> = Mutex::new(None);

    /// Connects to the session bus and starts listening. Call at startup;
    /// `show` connects (again) itself when needed.
    pub fn install(app: &AppHandle) {
        let _ = service(app);
    }

    fn service(app: &AppHandle) -> Option<Arc<Service>> {
        let mut current = SERVICE.lock().unwrap();
        if let Some(service) = current.as_ref().filter(|s| s.alive()) {
            return Some(Arc::clone(service));
        }
        if let Some(dead) = current.take() {
            dead.retire();
        }
        let app = app.clone();
        let connection = zbus::blocking::connection::Builder::session()
            .ok()?
            .method_timeout(CALL_TIMEOUT)
            .build()
            .ok()?;
        let service = Service::connect(connection, move |thread_id| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            let _ = NotificationOpenedEvent { thread_id }.emit(&app);
        })
        .ok()?;
        *current = Some(Arc::clone(&service));
        Some(service)
    }

    pub fn show(app: &AppHandle, notice: Notice) {
        if let Some(service) = service(app) {
            service.post(&notice);
        }
    }

    pub fn clear_all() {
        let service = SERVICE.lock().unwrap().clone();
        if let Some(service) = service {
            service.clear_all();
        }
    }
}

/// The Linux notifications against a fake notification service on a
/// private bus, which (like GNOME) takes a close only from the connection
/// that posted the notification. Needs `dbus-daemon`; skipped with a note
/// without it, except in CI.
#[cfg(all(test, target_os = "linux"))]
mod linux_tests {
    use std::collections::{HashMap, HashSet};
    use std::io::BufRead;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::{Duration, Instant};

    use mail_core::mail::notify::Notice;
    use mail_core::model::ThreadId;
    use zbus::blocking::{connection, Connection};
    use zbus::message::Header;
    use zbus::zvariant::OwnedValue;

    use super::linux::Service;

    /// Who posted each notification; which closes to refuse; whether to
    /// stop answering.
    #[derive(Default, Clone)]
    struct Fake {
        owners: Arc<Mutex<HashMap<u32, String>>>,
        refuse: Arc<Mutex<HashSet<u32>>>,
        stall: Arc<AtomicBool>,
    }

    #[zbus::interface(name = "org.freedesktop.Notifications")]
    impl Fake {
        #[allow(clippy::too_many_arguments)]
        fn notify(
            &self,
            #[zbus(header)] header: Header<'_>,
            _app: &str,
            _replaces: u32,
            _icon: &str,
            _summary: &str,
            _body: &str,
            _actions: Vec<String>,
            _hints: HashMap<String, OwnedValue>,
            _timeout: i32,
        ) -> u32 {
            if self.stall.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_secs(3));
            }
            let mut owners = self.owners.lock().unwrap();
            // Numbered from 1, as a freshly started service does.
            let id = (1..).find(|i| !owners.contains_key(i)).unwrap();
            let sender = header.sender().map(|s| s.to_string()).unwrap_or_default();
            owners.insert(id, sender);
            id
        }

        fn close_notification(
            &self,
            #[zbus(header)] header: Header<'_>,
            id: u32,
        ) -> zbus::fdo::Result<()> {
            let sender = header.sender().map(|s| s.to_string()).unwrap_or_default();
            let mut owners = self.owners.lock().unwrap();
            if owners.get(&id) != Some(&sender) || self.refuse.lock().unwrap().contains(&id) {
                return Err(zbus::fdo::Error::AccessDenied("not yours".into()));
            }
            owners.remove(&id);
            Ok(())
        }
    }

    fn notice(thread: i64) -> Notice {
        Notice {
            title: "Maya Chen".into(),
            body: "Lunch?".into(),
            thread: Some(ThreadId(thread)),
        }
    }

    struct Bus {
        daemon: std::process::Child,
        address: String,
    }

    impl Drop for Bus {
        fn drop(&mut self) {
            let _ = self.daemon.kill();
            let _ = self.daemon.wait();
        }
    }

    fn bus() -> Option<Bus> {
        let Ok(mut daemon) = std::process::Command::new("dbus-daemon")
            .args(["--session", "--print-address", "--nofork"])
            .stdout(std::process::Stdio::piped())
            .spawn()
        else {
            assert!(std::env::var_os("CI").is_none(), "CI has dbus-daemon");
            eprintln!("skipped: no dbus-daemon here");
            return None;
        };
        let mut address = String::new();
        std::io::BufReader::new(daemon.stdout.take().unwrap())
            .read_line(&mut address)
            .unwrap();
        Some(Bus {
            daemon,
            address: address.trim().to_string(),
        })
    }

    fn serve(bus: &Bus, fake: &Fake) -> Connection {
        connection::Builder::address(bus.address.as_str())
            .unwrap()
            .name("org.freedesktop.Notifications")
            .unwrap()
            .serve_at("/org/freedesktop/Notifications", fake.clone())
            .unwrap()
            .build()
            .unwrap()
    }

    fn client(bus: &Bus, timeout: Duration) -> Connection {
        connection::Builder::address(bus.address.as_str())
            .unwrap()
            .method_timeout(timeout)
            .build()
            .unwrap()
    }

    fn emit(
        server: &Connection,
        member: &str,
        body: &(impl serde::Serialize + zbus::zvariant::DynamicType),
    ) {
        server
            .emit_signal(
                None::<()>,
                "/org/freedesktop/Notifications",
                "org.freedesktop.Notifications",
                member,
                body,
            )
            .unwrap();
    }

    fn eventually(what: &str, check: impl Fn() -> bool) {
        let start = Instant::now();
        while !check() {
            assert!(start.elapsed() < Duration::from_secs(10), "{what}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn a_click_opens_its_conversation_even_when_the_close_follows_at_once() {
        let Some(bus) = bus() else { return };
        let fake = Fake::default();
        let server = serve(&bus, &fake);
        let (clicked, clicks) = mpsc::channel();
        let service = Service::connect(client(&bus, Duration::from_secs(5)), move |thread| {
            clicked.send(thread).unwrap();
        })
        .unwrap();
        service.post(&notice(42));
        service.post(&notice(7));
        assert_eq!(service.shown(), [1, 2]);

        // Another action, or a notification that isn't the app's: nothing.
        emit(&server, "ActionInvoked", &(2u32, "reply"));
        emit(&server, "ActionInvoked", &(99u32, "default"));
        // A click, and the close a desktop sends right after it.
        emit(&server, "ActionInvoked", &(1u32, "default"));
        emit(&server, "NotificationClosed", &(1u32, 2u32));
        let first = clicks.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(first, Some(ThreadId(42)));
        assert!(clicks.recv_timeout(Duration::from_millis(300)).is_err());
        eventually("the closed one is forgotten", || service.shown() == [2]);
    }

    #[test]
    fn the_app_takes_back_only_its_own_and_keeps_what_was_refused() {
        let Some(bus) = bus() else { return };
        let fake = Fake::default();
        let _server = serve(&bus, &fake);
        let service = Service::connect(client(&bus, Duration::from_secs(5)), |_| {}).unwrap();
        service.post(&notice(42));
        service.post(&notice(7));

        // The fake refuses a close from another connection, as GNOME does.
        let other = client(&bus, Duration::from_secs(5));
        let refused = other.call_method(
            Some("org.freedesktop.Notifications"),
            "/org/freedesktop/Notifications",
            Some("org.freedesktop.Notifications"),
            "CloseNotification",
            &(1u32,),
        );
        assert!(refused.is_err());
        // From the connection that posted them: one taken back; the one the
        // service refused stays listed for the next try.
        fake.refuse.lock().unwrap().insert(2);
        service.clear_all();
        assert_eq!(service.shown(), [2]);
        fake.refuse.lock().unwrap().clear();
        service.clear_all();
        assert!(service.shown().is_empty());
        assert!(fake.owners.lock().unwrap().is_empty());
    }

    #[test]
    fn a_service_that_stops_answering_doesnt_hold_up_the_app() {
        let Some(bus) = bus() else { return };
        let fake = Fake::default();
        let server = serve(&bus, &fake);
        let (clicked, clicks) = mpsc::channel();
        let service = Service::connect(client(&bus, Duration::from_millis(300)), move |thread| {
            clicked.send(thread).unwrap();
        })
        .unwrap();
        service.post(&notice(42));
        fake.stall.store(true, Ordering::Release);
        let started = Instant::now();
        service.post(&notice(7));
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "post waited on the service"
        );
        // A slow answer isn't a lost connection: the same one carries on.
        assert!(service.alive());
        // Taking them back stops at the first call that times out.
        let started = Instant::now();
        service.clear_all();
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "clear_all waited on each"
        );
        // A click on the first still opens it, and once the service answers
        // again, posting works on the same connection.
        emit(&server, "ActionInvoked", &(1u32, "default"));
        assert_eq!(
            clicks.recv_timeout(Duration::from_secs(5)).unwrap(),
            Some(ThreadId(42))
        );
        // The fake blocks its own executor while it stalls, so it takes a
        // moment to answer again; the app keeps the same connection.
        fake.stall.store(false, Ordering::Release);
        eventually("posting works again on the same connection", || {
            service.post(&notice(9));
            service.shown().len() >= 2
        });
        assert!(service.alive());
    }

    #[test]
    fn a_click_from_anyone_but_the_service_is_ignored() {
        let Some(bus) = bus() else { return };
        let fake = Fake::default();
        let _server = serve(&bus, &fake);
        let (clicked, clicks) = mpsc::channel();
        let service = Service::connect(client(&bus, Duration::from_secs(5)), move |thread| {
            clicked.send(thread).unwrap();
        })
        .unwrap();
        service.post(&notice(42));
        let stranger = client(&bus, Duration::from_secs(5));
        emit(&stranger, "ActionInvoked", &(1u32, "default"));
        assert!(clicks.recv_timeout(Duration::from_millis(500)).is_err());
    }

    #[test]
    fn a_restarted_service_doesnt_open_an_old_conversation() {
        let Some(bus) = bus() else { return };
        let fake = Fake::default();
        let server = serve(&bus, &fake);
        let (clicked, clicks) = mpsc::channel();
        let service = Service::connect(client(&bus, Duration::from_secs(5)), move |thread| {
            clicked.send(thread).unwrap();
        })
        .unwrap();
        service.post(&notice(42));
        assert_eq!(service.shown(), [1]);
        // The service restarts: a new owner of its name, numbering from 1.
        drop(server);
        let restarted = serve(&bus, &Fake::default());
        eventually("the old IDs are forgotten", || service.shown().is_empty());
        // ID 1 at the new service isn't the app's yet: no click.
        emit(&restarted, "ActionInvoked", &(1u32, "default"));
        assert!(clicks.recv_timeout(Duration::from_millis(500)).is_err());
        // The app's next notification is ID 1 there, and a click opens it.
        service.post(&notice(7));
        assert_eq!(service.shown(), [1]);
        emit(&restarted, "ActionInvoked", &(1u32, "default"));
        assert_eq!(
            clicks.recv_timeout(Duration::from_secs(5)).unwrap(),
            Some(ThreadId(7))
        );
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

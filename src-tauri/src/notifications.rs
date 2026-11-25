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
/// tested on every system. Each is kept under the unique bus name of the
/// service that numbered it and that number: unique names are never used
/// twice, so a restarted service (which numbers afresh) can't be mistaken
/// for the old one, whatever order the bus's messages arrive in.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
mod linux_state {
    use std::collections::{HashMap, VecDeque};

    use mail_core::model::ThreadId;

    /// How many shown notifications are remembered. A service that never
    /// says one was closed would otherwise grow the list for as long as
    /// the app runs; the oldest posted is forgotten first.
    pub const REMEMBERED: usize = 256;

    /// A notification: the service that numbered it, and its number.
    pub type Key = (String, u32);

    #[derive(Default)]
    pub struct Shown {
        conversations: HashMap<Key, Option<ThreadId>>,
        order: VecDeque<Key>,
    }

    impl Shown {
        /// The service `owner` numbered a notification `id`.
        pub fn posted(&mut self, owner: &str, id: u32, thread: Option<ThreadId>) {
            let key = (owner.to_string(), id);
            if self.conversations.insert(key.clone(), thread).is_none() {
                self.order.push_back(key);
            }
            while self.order.len() > REMEMBERED {
                if let Some(oldest) = self.order.pop_front() {
                    self.conversations.remove(&oldest);
                }
            }
        }

        /// The conversation of a notification, if it's the app's.
        pub fn conversation(&self, owner: &str, id: u32) -> Option<Option<ThreadId>> {
            self.conversations.get(&(owner.to_string(), id)).copied()
        }

        pub fn closed(&mut self, owner: &str, id: u32) {
            let key = (owner.to_string(), id);
            if self.conversations.remove(&key).is_some() {
                self.order.retain(|k| k != &key);
            }
        }

        /// A service left the bus: its notifications went with it.
        pub fn gone(&mut self, owner: &str) {
            self.conversations.retain(|(o, _), _| o != owner);
            self.order.retain(|(o, _)| o != owner);
        }

        pub fn keys(&self) -> Vec<Key> {
            self.order.iter().cloned().collect()
        }
    }

    #[cfg(test)]
    mod tests {
        use super::{Shown, REMEMBERED};
        use mail_core::model::ThreadId;

        #[test]
        fn a_restarted_service_numbering_afresh_is_never_taken_for_the_old_one() {
            let mut s = Shown::default();
            s.posted(":1.10", 1, Some(ThreadId(42)));
            // The service restarts as :1.20 and numbers from 1 again, and the
            // bus's notice that :1.10 left comes after, or never.
            s.posted(":1.20", 1, Some(ThreadId(7)));
            assert_eq!(s.conversation(":1.10", 1), Some(Some(ThreadId(42))));
            assert_eq!(s.conversation(":1.20", 1), Some(Some(ThreadId(7))));
            s.gone(":1.10");
            assert_eq!(s.conversation(":1.10", 1), None);
            assert_eq!(s.conversation(":1.20", 1), Some(Some(ThreadId(7))));
            // A notice about a service the app never posted to changes nothing.
            s.gone(":1.99");
            assert_eq!(s.keys(), [(":1.20".to_string(), 1)]);
        }

        #[test]
        fn closed_ones_are_forgotten_and_the_list_has_a_limit() {
            let mut s = Shown::default();
            for id in 1..=(REMEMBERED as u32 + 10) {
                s.posted(":1.10", id, None);
            }
            assert_eq!(s.keys().len(), REMEMBERED);
            assert_eq!(s.keys()[0], (":1.10".to_string(), 11));
            s.closed(":1.10", 11);
            assert_eq!(s.conversation(":1.10", 11), None);
            assert_eq!(s.keys().len(), REMEMBERED - 1);
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{self, Receiver, SyncSender};
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

    use super::linux_state::Shown;
    use super::NotificationOpenedEvent;

    const NAME: &str = "org.freedesktop.Notifications";
    const PATH: &str = "/org/freedesktop/Notifications";

    /// How long taking them all back may hold up its caller (Delete all
    /// data). What isn't done by then is still done, by the worker, once
    /// the service answers.
    pub const CLEAR_DEADLINE: Duration = Duration::from_secs(10);

    /// How many posts may wait while the service is slow to answer; more
    /// are dropped rather than piling up.
    const QUEUED: usize = 32;

    enum Job {
        Post(Notice),
        /// Take back every notification shown, then say so.
        ClearAll(SyncSender<()>),
    }

    /// The app's one connection to the notification service. Every call
    /// goes through one worker, in order, so a service that is slow to
    /// answer never holds up the app, and a reply that comes late is still
    /// recorded (its notification can still be clicked and taken back).
    /// One connection for everything, as a service may take a close only
    /// from the connection that posted the notification (GNOME checks).
    pub struct Service {
        connection: Connection,
        /// The worker's and listeners' list, kept here for the tests.
        #[cfg_attr(not(test), allow(dead_code))]
        shown: Arc<Mutex<Shown>>,
        jobs: SyncSender<Job>,
        alive: Arc<AtomicBool>,
    }

    impl Service {
        /// Starts listening on `connection`: `on_click` gets the
        /// conversation of a notification of this app's that was clicked
        /// (the "default" action, which GNOME, KDE and most others send for
        /// a click on it).
        pub fn connect(
            connection: Connection,
            on_click: impl Fn(Option<ThreadId>) + Send + 'static,
        ) -> zbus::Result<Service> {
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
            let shown = Arc::new(Mutex::new(Shown::default()));
            let alive = Arc::new(AtomicBool::new(true));

            // Clicks and closes, in the order the service sent them, matched
            // by the sender's unique name and the notification's number.
            let listening = Arc::clone(&shown);
            let living = Arc::clone(&alive);
            std::thread::spawn(move || {
                for message in signals {
                    let Ok(message) = message else { break };
                    let header = message.header();
                    let Some(sender) = header.sender().map(|s| s.to_string()) else {
                        continue;
                    };
                    match header.member().map(|m| m.as_str()) {
                        Some("ActionInvoked") => {
                            let Ok((id, action)) = message.body().deserialize::<(u32, String)>()
                            else {
                                continue;
                            };
                            let thread = listening.lock().unwrap().conversation(&sender, id);
                            if let (Some(thread), "default") = (thread, action.as_str()) {
                                on_click(thread);
                            }
                        }
                        Some("NotificationClosed") => {
                            if let Ok((id, _reason)) = message.body().deserialize::<(u32, u32)>() {
                                listening.lock().unwrap().closed(&sender, id);
                            }
                        }
                        _ => {}
                    }
                }
                living.store(false, Ordering::Release);
            });

            // A service that leaves the bus takes its notifications with it.
            let listening = Arc::clone(&shown);
            let living = Arc::clone(&alive);
            std::thread::spawn(move || {
                for message in owners {
                    let Ok(message) = message else { break };
                    if let Ok((_, old, _)) =
                        message.body().deserialize::<(String, String, String)>()
                    {
                        if !old.is_empty() {
                            listening.lock().unwrap().gone(&old);
                        }
                    }
                }
                living.store(false, Ordering::Release);
            });

            let (jobs, queue) = mpsc::sync_channel(QUEUED);
            let worker = Worker {
                connection: connection.clone(),
                shown: Arc::clone(&shown),
                alive: Arc::clone(&alive),
            };
            std::thread::spawn(move || worker.run(queue));

            Ok(Service {
                connection,
                shown,
                jobs,
                alive,
            })
        }

        pub fn alive(&self) -> bool {
            self.alive.load(Ordering::Acquire)
        }

        /// Closes the connection: the listeners and the worker end, and the
        /// next notification connects again.
        pub fn retire(&self) {
            self.alive.store(false, Ordering::Release);
            let _ = self.connection.clone().close();
        }

        /// Queues one to be shown. Never waits on the service.
        pub fn post(&self, notice: Notice) {
            let _ = self.jobs.try_send(Job::Post(notice));
        }

        /// Takes back every notification shown, including any still being
        /// posted, waiting at most `deadline`; the rest is done when the
        /// service answers.
        pub fn clear_all(&self, deadline: Duration) {
            let (done, finished) = mpsc::sync_channel(1);
            let started = Instant::now();
            if self.jobs.send_within(Job::ClearAll(done), deadline).is_ok() {
                let left = deadline.saturating_sub(started.elapsed());
                let _ = finished.recv_timeout(left);
            }
        }

        #[cfg(test)]
        pub fn shown(&self) -> Vec<u32> {
            let mut ids: Vec<u32> = self
                .shown
                .lock()
                .unwrap()
                .keys()
                .iter()
                .map(|k| k.1)
                .collect();
            ids.sort();
            ids
        }
    }

    /// The thread that makes every call, one at a time.
    struct Worker {
        connection: Connection,
        shown: Arc<Mutex<Shown>>,
        alive: Arc<AtomicBool>,
    }

    trait SendWithin<T> {
        fn send_within(&self, value: T, timeout: Duration) -> Result<(), ()>;
    }

    impl<T> SendWithin<T> for SyncSender<T> {
        /// `send`, giving up after `timeout` when the queue stays full.
        fn send_within(&self, mut value: T, timeout: Duration) -> Result<(), ()> {
            let started = Instant::now();
            loop {
                match self.try_send(value) {
                    Ok(()) => return Ok(()),
                    Err(mpsc::TrySendError::Disconnected(_)) => return Err(()),
                    Err(mpsc::TrySendError::Full(back)) => {
                        if started.elapsed() >= timeout {
                            return Err(());
                        }
                        value = back;
                        std::thread::sleep(Duration::from_millis(20));
                    }
                }
            }
        }
    }

    impl Worker {
        fn run(self, queue: Receiver<Job>) {
            for job in queue {
                if !self.alive.load(Ordering::Acquire) {
                    break;
                }
                match job {
                    Job::Post(notice) => self.post(&notice),
                    Job::ClearAll(done) => {
                        self.clear_all();
                        let _ = done.try_send(());
                    }
                }
            }
        }

        /// A call error other than the service's own answer means the
        /// connection is gone: close it, so everything on it ends.
        fn lost(&self, e: &zbus::Error) -> bool {
            if matches!(e, zbus::Error::MethodError(..)) {
                return false;
            }
            self.alive.store(false, Ordering::Release);
            let _ = self.connection.clone().close();
            true
        }

        fn post(&self, notice: &Notice) {
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
                    if let (Some(owner), Ok(id)) =
                        (header.sender(), reply.body().deserialize::<u32>())
                    {
                        self.shown
                            .lock()
                            .unwrap()
                            .posted(owner.as_str(), id, notice.thread);
                    }
                }
                Err(e) => {
                    self.lost(&e);
                }
            }
        }

        /// Each notification is taken back from the service that numbered
        /// it. One the service refused stays listed for the next try; one
        /// whose service is gone is forgotten.
        fn clear_all(&self) {
            let keys = self.shown.lock().unwrap().keys();
            for (owner, id) in keys {
                let closed = self.connection.call_method(
                    Some(owner.as_str()),
                    PATH,
                    Some(NAME),
                    "CloseNotification",
                    &(id,),
                );
                match closed {
                    Ok(_) => self.shown.lock().unwrap().closed(&owner, id),
                    Err(zbus::Error::MethodError(name, ..))
                        if name.as_str() == "org.freedesktop.DBus.Error.ServiceUnknown" =>
                    {
                        self.shown.lock().unwrap().gone(&owner);
                    }
                    Err(e) => {
                        if self.lost(&e) {
                            return;
                        }
                    }
                }
            }
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
        let connection = zbus::blocking::Connection::session().ok()?;
        let service = Arc::new(
            Service::connect(connection, move |thread_id| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let _ = NotificationOpenedEvent { thread_id }.emit(&app);
            })
            .ok()?,
        );
        *current = Some(Arc::clone(&service));
        Some(service)
    }

    pub fn show(app: &AppHandle, notice: Notice) {
        if let Some(service) = service(app) {
            service.post(notice);
        }
    }

    pub fn clear_all() {
        let service = SERVICE.lock().unwrap().clone();
        if let Some(service) = service {
            service.clear_all(CLEAR_DEADLINE);
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
    /// stop answering (each call then takes `STALL`).
    #[derive(Default, Clone)]
    struct Fake {
        owners: Arc<Mutex<HashMap<u32, String>>>,
        refuse: Arc<Mutex<HashSet<u32>>>,
        stall: Arc<AtomicBool>,
    }

    const STALL: Duration = Duration::from_secs(2);

    impl Fake {
        fn wait(&self) {
            if self.stall.load(Ordering::Acquire) {
                std::thread::sleep(STALL);
            }
        }
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
            self.wait();
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
            self.wait();
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

    fn client(bus: &Bus) -> Connection {
        connection::Builder::address(bus.address.as_str())
            .unwrap()
            .build()
            .unwrap()
    }

    fn emit(
        from: &Connection,
        member: &str,
        body: &(impl serde::Serialize + zbus::zvariant::DynamicType),
    ) {
        from.emit_signal(
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

    fn connect(bus: &Bus) -> (Service, mpsc::Receiver<Option<ThreadId>>) {
        let (clicked, clicks) = mpsc::channel();
        let service = Service::connect(client(bus), move |thread| {
            let _ = clicked.send(thread);
        })
        .unwrap();
        (service, clicks)
    }

    #[test]
    fn a_click_opens_its_conversation_even_when_the_close_follows_at_once() {
        let Some(bus) = bus() else { return };
        let server = serve(&bus, &Fake::default());
        let (service, clicks) = connect(&bus);
        service.post(notice(42));
        service.post(notice(7));
        eventually("both posted", || service.shown() == [1, 2]);

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
    fn a_click_from_anyone_but_the_service_is_ignored() {
        let Some(bus) = bus() else { return };
        let _server = serve(&bus, &Fake::default());
        let (service, clicks) = connect(&bus);
        service.post(notice(42));
        eventually("posted", || service.shown() == [1]);
        let stranger = client(&bus);
        emit(&stranger, "ActionInvoked", &(1u32, "default"));
        assert!(clicks.recv_timeout(Duration::from_millis(500)).is_err());
    }

    #[test]
    fn the_app_takes_back_only_its_own_and_keeps_what_was_refused() {
        let Some(bus) = bus() else { return };
        let fake = Fake::default();
        let _server = serve(&bus, &fake);
        let (service, _clicks) = connect(&bus);
        service.post(notice(42));
        service.post(notice(7));
        eventually("both posted", || service.shown() == [1, 2]);

        // The fake refuses a close from another connection, as GNOME does.
        let refused = client(&bus).call_method(
            Some("org.freedesktop.Notifications"),
            "/org/freedesktop/Notifications",
            Some("org.freedesktop.Notifications"),
            "CloseNotification",
            &(1u32,),
        );
        assert!(refused.is_err());
        // From the app's connection: one taken back; the one the service
        // refused stays listed for the next try.
        fake.refuse.lock().unwrap().insert(2);
        service.clear_all(Duration::from_secs(5));
        assert_eq!(service.shown(), [2]);
        fake.refuse.lock().unwrap().clear();
        service.clear_all(Duration::from_secs(5));
        assert!(service.shown().is_empty());
        assert!(fake.owners.lock().unwrap().is_empty());
    }

    #[test]
    fn a_slow_service_holds_up_nothing_and_its_late_answers_still_count() {
        let Some(bus) = bus() else { return };
        let fake = Fake::default();
        let server = serve(&bus, &fake);
        let (service, clicks) = connect(&bus);
        fake.stall.store(true, Ordering::Release);
        // Posting never waits on the service.
        let started = Instant::now();
        service.post(notice(42));
        service.post(notice(7));
        assert!(started.elapsed() < Duration::from_millis(500));
        // Taking them back waits no longer than its deadline, though the
        // service is still answering the posts...
        let started = Instant::now();
        service.clear_all(Duration::from_secs(1));
        assert!(started.elapsed() < Duration::from_secs(2));
        // ...and is done all the same once it answers: what the service
        // showed late is recorded and then taken back, none left behind.
        fake.stall.store(false, Ordering::Release);
        eventually("the late posts are taken back", || {
            fake.owners.lock().unwrap().is_empty() && service.shown().is_empty()
        });
        assert!(service.alive());
        // A post now is clickable as usual.
        service.post(notice(9));
        eventually("posted", || service.shown().len() == 1);
        let id = service.shown()[0];
        emit(&server, "ActionInvoked", &(id, "default"));
        assert_eq!(
            clicks.recv_timeout(Duration::from_secs(5)).unwrap(),
            Some(ThreadId(9))
        );
    }

    #[test]
    fn a_restarted_service_doesnt_open_an_old_conversation() {
        let Some(bus) = bus() else { return };
        let server = serve(&bus, &Fake::default());
        let (service, clicks) = connect(&bus);
        service.post(notice(42));
        eventually("posted", || service.shown() == [1]);
        // The service restarts: a new owner of its name, numbering from 1.
        // The app posts to it at once, before or after the bus's notice.
        drop(server);
        let restarted = serve(&bus, &Fake::default());
        service.post(notice(7));
        eventually("only the new service's notification is left", || {
            service.shown() == [1]
        });
        // The new service's 1 is the new conversation, never the old one.
        emit(&restarted, "ActionInvoked", &(1u32, "default"));
        assert_eq!(
            clicks.recv_timeout(Duration::from_secs(5)).unwrap(),
            Some(ThreadId(7))
        );
        assert!(clicks.recv_timeout(Duration::from_millis(300)).is_err());
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

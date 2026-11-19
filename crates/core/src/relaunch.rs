//! Starting the app again after it installed an update (macOS).
//!
//! Tauri's own restart runs `open -n <bundle>` while the old process is
//! still running, so macOS starts a second copy beside it. With the app
//! kept in the Dock, the new copy got an icon of its own at the end of the
//! Dock, apart from the kept one (owner, 2026-11-19). Instead a small
//! helper waits for this process to end, then opens the bundle as a click
//! on its icon would, without `-n`, so macOS starts it as the app in the
//! Dock. If that fails, it starts the app's program directly, as Tauri's
//! restart does when `open` fails, so the app never stays closed.

use std::path::{Path, PathBuf};

/// How long the helper waits for the app to end before opening it anyway,
/// in tenths of a second (30 s).
pub const WAIT_TICKS: u32 = 300;

/// The `.app` bundle that an executable at `<bundle>.app/Contents/MacOS/<name>`
/// belongs to, or `None` for one that isn't in a bundle (a development build).
pub fn bundle_of(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent()?;
    if macos.file_name()? != "MacOS" {
        return None;
    }
    let contents = macos.parent()?;
    if contents.file_name()? != "Contents" {
        return None;
    }
    let bundle = contents.parent()?;
    (bundle.extension()? == "app").then(|| bundle.to_path_buf())
}

/// Starts the helper that opens `bundle` again once this process has ended,
/// or runs `exe` (this process's program, as installed) if that fails. The
/// caller then quits the app.
#[cfg(unix)]
pub fn after_exit(bundle: &Path, exe: &Path) -> std::io::Result<()> {
    spawn_waiter(
        Path::new("/usr/bin/open"),
        bundle,
        &[exe],
        std::process::id(),
        WAIT_TICKS,
    )
}

/// The helper is a copy of this process (`fork`) that waits while process
/// `pid` runs (at most `ticks` tenths of a second, then half a second more,
/// so macOS has let go of the old copy and starts a new one rather than
/// looking for the one that just quit), then runs `opener` with `bundle`
/// and waits for it. If the opener can't run or fails, the helper becomes
/// `fallback` (a program and its arguments). No shell runs it (DASA 1.4.2),
/// and nothing is shipped for it. Everything it needs is prepared before
/// the copy is made; the copy, made from a process with many threads, only
/// makes system calls that are safe there (no allocation, no locks) until
/// it becomes another program. It starts a session of its own, so it
/// outlives the app, and closes the files the app had open (its database,
/// for one), so it holds none of them while the new version starts.
#[cfg(unix)]
fn spawn_waiter(
    opener: &Path,
    bundle: &Path,
    fallback: &[&Path],
    pid: u32,
    ticks: u32,
) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let invalid = || std::io::Error::from(std::io::ErrorKind::InvalidInput);
    let c_path = |p: &Path| CString::new(p.as_os_str().as_bytes()).map_err(|_| invalid());
    let program = c_path(opener)?;
    let target = c_path(bundle)?;
    let argv = [program.as_ptr(), target.as_ptr(), std::ptr::null()];
    let fallback = fallback
        .iter()
        .map(|p| c_path(p))
        .collect::<std::io::Result<Vec<_>>>()?;
    let first = fallback.first().ok_or_else(invalid)?;
    let mut fallback_argv: Vec<*const libc::c_char> = fallback.iter().map(|c| c.as_ptr()).collect();
    fallback_argv.push(std::ptr::null());
    let pid = libc::pid_t::try_from(pid).map_err(|_| invalid())?;
    let null_path = c"/dev/null";
    // Every descriptor the app may have open: the larger of the current
    // limit and the hard one (capped), as one opened under a higher limit
    // stays open if the limit is lowered.
    // SAFETY: plain system calls into memory owned here.
    let max_fd = unsafe {
        let mut limit = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        let hard = if libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) == 0 {
            limit.rlim_max.min(65_536) as libc::c_int
        } else {
            0
        };
        libc::getdtablesize().max(hard)
    };
    let tick = libc::timespec {
        tv_sec: 0,
        tv_nsec: 100_000_000,
    };
    let settle = libc::timespec {
        tv_sec: 0,
        tv_nsec: 500_000_000,
    };
    // SAFETY: `fork` takes nothing; what the child may do follows.
    match unsafe { libc::fork() } {
        -1 => Err(std::io::Error::last_os_error()),
        // SAFETY: in the child, only async-signal-safe calls are made
        // (setsid, open, dup2, close, kill, nanosleep, fork, execv, waitpid,
        // _exit) on memory prepared before the fork, as POSIX requires after
        // forking a process with threads.
        0 => unsafe {
            libc::setsid();
            let null = libc::open(null_path.as_ptr(), libc::O_RDWR);
            if null >= 0 {
                libc::dup2(null, 0);
                libc::dup2(null, 1);
                libc::dup2(null, 2);
            }
            for fd in 3..max_fd {
                libc::close(fd);
            }
            let mut waited = 0;
            while waited < ticks && libc::kill(pid, 0) == 0 {
                libc::nanosleep(&tick, std::ptr::null_mut());
                waited += 1;
            }
            libc::nanosleep(&settle, std::ptr::null_mut());
            let opening = libc::fork();
            if opening == 0 {
                libc::execv(program.as_ptr(), argv.as_ptr());
                libc::_exit(127);
            }
            if opening > 0 {
                let mut status = 0;
                if libc::waitpid(opening, &mut status, 0) == opening
                    && libc::WIFEXITED(status)
                    && libc::WEXITSTATUS(status) == 0
                {
                    libc::_exit(0);
                }
            }
            libc::execv(first.as_ptr(), fallback_argv.as_ptr());
            libc::_exit(127)
        },
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn finds_the_bundle_of_its_executable() {
        assert_eq!(
            bundle_of(Path::new("/Applications/App.app/Contents/MacOS/app")),
            Some(PathBuf::from("/Applications/App.app"))
        );
        assert_eq!(
            bundle_of(Path::new("/Users/x/Apps/My App.app/Contents/MacOS/My App")),
            Some(PathBuf::from("/Users/x/Apps/My App.app"))
        );
    }

    #[test]
    fn an_executable_outside_a_bundle_has_none() {
        assert_eq!(bundle_of(Path::new("/repo/target/debug/app")), None);
        assert_eq!(bundle_of(Path::new("/x/Contents/MacOS/app")), None);
        assert_eq!(bundle_of(Path::new("/x/App.app/MacOS/app")), None);
        assert_eq!(bundle_of(Path::new("app")), None);
    }

    /// The opener in the tests: `touch`, given a file's path as the
    /// "bundle", makes that file, which shows when it ran and with what.
    #[cfg(unix)]
    const TOUCH: &str = "/usr/bin/touch";

    #[cfg(unix)]
    fn appears(path: &Path, within: Duration) -> bool {
        let start = Instant::now();
        while start.elapsed() < within {
            if path.exists() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    /// The app opens again only after the old process has ended, never
    /// beside it, and it is the bundle given; the fallback doesn't run.
    #[cfg(unix)]
    #[test]
    fn opens_the_bundle_only_once_the_app_has_ended() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("Some App.app");
        let fallback = dir.path().join("fallback");
        let mut app = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        spawn_waiter(
            Path::new(TOUCH),
            &bundle,
            &[Path::new(TOUCH), &fallback],
            app.id(),
            WAIT_TICKS,
        )
        .unwrap();
        assert!(!appears(&bundle, Duration::from_millis(1200)));
        app.kill().unwrap();
        app.wait().unwrap();
        assert!(appears(&bundle, Duration::from_secs(5)));
        assert!(!appears(&fallback, Duration::from_millis(500)));
    }

    /// An app that doesn't end isn't waited for forever: the bundle is
    /// opened after the wait (what macOS then does with the running copy
    /// isn't tested here).
    #[cfg(unix)]
    #[test]
    fn opens_anyway_after_the_wait() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("A.app");
        let mut app = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        spawn_waiter(
            Path::new(TOUCH),
            &bundle,
            &[Path::new("/usr/bin/true")],
            app.id(),
            3,
        )
        .unwrap();
        let opened = appears(&bundle, Duration::from_secs(5));
        app.kill().unwrap();
        app.wait().unwrap();
        assert!(opened);
    }

    /// If opening the bundle fails, the app's program is started instead,
    /// so the app doesn't stay closed.
    #[cfg(unix)]
    #[test]
    fn runs_the_fallback_when_opening_fails() {
        let dir = tempfile::tempdir().unwrap();
        let fallback = dir.path().join("fallback");
        let mut app = std::process::Command::new("/usr/bin/true").spawn().unwrap();
        app.wait().unwrap();
        spawn_waiter(
            Path::new("/usr/bin/false"),
            Path::new("/A.app"),
            &[Path::new(TOUCH), &fallback],
            app.id(),
            WAIT_TICKS,
        )
        .unwrap();
        assert!(appears(&fallback, Duration::from_secs(5)));
    }

    /// Likewise if the opener can't be run at all.
    #[cfg(unix)]
    #[test]
    fn runs_the_fallback_when_the_opener_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let fallback = dir.path().join("fallback");
        let mut app = std::process::Command::new("/usr/bin/true").spawn().unwrap();
        app.wait().unwrap();
        spawn_waiter(
            &dir.path().join("no-such-opener"),
            Path::new("/A.app"),
            &[Path::new(TOUCH), &fallback],
            app.id(),
            WAIT_TICKS,
        )
        .unwrap();
        assert!(appears(&fallback, Duration::from_secs(5)));
    }
}

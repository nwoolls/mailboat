//! Append-only sync diagnostics at `~/Library/Logs/<bundle id>/sync.log`
//! (macOS). Holds rate-limit details, retries and pass results; never email
//! content or tokens.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use mail_core::model::AccountId;

const MAX_BYTES: u64 = 5 * 1024 * 1024;

pub struct SyncLog {
    file: Mutex<Option<File>>,
    path: PathBuf,
}

impl SyncLog {
    pub fn open(dir: &Path) -> Self {
        let path = dir.join("sync.log");
        let _ = std::fs::create_dir_all(dir);
        // Start over once the log gets large; it's for recent diagnostics.
        if std::fs::metadata(&path).is_ok_and(|m| m.len() > MAX_BYTES) {
            let _ = std::fs::remove_file(&path);
        }
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        // Only this user reads it: new, and (below) an older log too, which
        // keeps the mode it had until it is set.
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let file = options.open(&path).ok();
        #[cfg(unix)]
        if file.is_some() {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        Self {
            file: Mutex::new(file),
            path,
        }
    }

    /// Where the log is, for Settings → Advanced.
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn write(&self, account: AccountId, line: &str) {
        let now = time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default();
        let entry = format!("{now} account={} {line}\n", account.0);
        eprint!("{entry}");
        if let Some(file) = self.file.lock().unwrap().as_mut() {
            let _ = file.write_all(entry.as_bytes());
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn mode(path: &Path) -> u32 {
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn the_log_is_private_to_this_user_new_or_old() {
        let dir = std::env::temp_dir().join(format!("sync-log-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let log = SyncLog::open(&dir);
        log.write(AccountId(1), "made-up line");
        assert_eq!(mode(log.path()), 0o600);

        // A log from an older run, with the usual open mode.
        drop(log);
        std::fs::set_permissions(dir.join("sync.log"), std::fs::Permissions::from_mode(0o644))
            .unwrap();
        let log = SyncLog::open(&dir);
        assert_eq!(mode(log.path()), 0o600);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

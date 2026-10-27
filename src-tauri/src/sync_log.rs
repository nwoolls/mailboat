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
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .ok();
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
        self.append(&format!("account={} {line}", account.0));
    }

    /// A line about the app rather than one account.
    pub fn note(&self, line: &str) {
        self.append(line);
    }

    fn append(&self, line: &str) {
        let now = time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default();
        let entry = format!("{now} {line}\n");
        eprint!("{entry}");
        if let Some(file) = self.file.lock().unwrap().as_mut() {
            let _ = file.write_all(entry.as_bytes());
        }
    }
}

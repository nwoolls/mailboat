//! Running a provider's program: find it, hand it the request on stdin,
//! read its answer line by line from stdout.

use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::error::{CoreError, Result};

/// Longest a request may take before it's given up on.
pub const TIMEOUT: Duration = Duration::from_secs(180);

/// Folders the Claude and Codex installers use. A Mac app starts with a
/// bare PATH (`/usr/bin:/bin:…`), not the shell's, so these are searched
/// as well as PATH.
fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    if let Some(home) = std::env::var_os(home_var).map(PathBuf::from) {
        for rel in [
            ".local/bin",
            ".claude/local",
            ".bun/bin",
            ".npm-global/bin",
            ".volta/bin",
            ".cargo/bin",
        ] {
            dirs.push(home.join(rel));
        }
    }
    if cfg!(windows) {
        // Where `npm install -g` puts its `.cmd` launchers.
        if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) {
            dirs.push(appdata.join("npm"));
        }
    } else {
        dirs.push("/opt/homebrew/bin".into());
        dirs.push("/usr/local/bin".into());
    }
    dirs
}

/// The names a program's file can have: on Windows `claude.exe` or (from
/// npm) `codex.cmd`, elsewhere just the name.
fn file_names(name: &str) -> Vec<String> {
    if cfg!(windows) {
        ["exe", "cmd"]
            .iter()
            .map(|ext| format!("{name}.{ext}"))
            .collect()
    } else {
        vec![name.to_string()]
    }
}

/// The program's full path, if it's installed in one of the usual places.
pub fn find_program(name: &str) -> Option<PathBuf> {
    let names = file_names(name);
    search_dirs()
        .into_iter()
        .flat_map(|d| names.iter().map(move |n| d.join(n)))
        .find(|p| p.is_file())
}

/// PATH for the child: the usual folders, so a tool installed with npm
/// finds `node`.
fn child_path(program: &Path) -> std::ffi::OsString {
    let mut dirs = search_dirs();
    if let Some(parent) = program.parent() {
        dirs.insert(0, parent.to_path_buf());
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

/// How a finished program exited.
#[derive(Debug)]
pub struct Exit {
    pub success: bool,
    /// The end of what it wrote to stderr (for error messages; never logged,
    /// since it could quote the email).
    pub stderr: String,
}

/// Runs `program` in an empty folder, writes `stdin`, and calls `on_line`
/// for each line it prints. An error from `on_line` stops the program.
/// So does `Break`, for the line that ends the answer: Claude and Codex
/// take another half second or so to exit after it, which would otherwise
/// be waited out (measured 2026-10-24). The program is killed if this
/// future is dropped (cancelled).
pub async fn run_lines(
    program: &Path,
    args: &[String],
    stdin: &str,
    mut on_line: impl FnMut(&str) -> Result<ControlFlow<()>>,
) -> Result<Exit> {
    let work = tokio::time::timeout(TIMEOUT, async {
        let dir = scratch_dir()?;
        let mut child = Command::new(program)
            .args(args)
            .current_dir(&dir)
            .env("PATH", child_path(program))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| CoreError::Ai(format!("couldn't start {}: {e}", program.display())))?;
        let mut input = child.stdin.take().expect("piped stdin");
        let text = stdin.to_string();
        // Written alongside reading, so a large prompt can't fill the pipe
        // while the program waits for us to read its output.
        let writer = tokio::spawn(async move {
            let _ = input.write_all(text.as_bytes()).await;
            let _ = input.shutdown().await;
        });
        let mut err = child.stderr.take().expect("piped stderr");
        let stderr = tokio::spawn(async move {
            let mut buf = Vec::new();
            let _ = err.read_to_end(&mut buf).await;
            buf
        });
        let mut lines = BufReader::new(child.stdout.take().expect("piped stdout")).lines();
        while let Some(line) = lines
            .next_line()
            .await
            .map_err(|e| CoreError::Ai(format!("reading the answer: {e}")))?
        {
            if !line.trim().is_empty() && on_line(&line)?.is_break() {
                // The answer is in: stop the program rather than wait for
                // it to exit, and reap it so it doesn't linger.
                let _ = child.start_kill();
                let _ = child.wait().await;
                writer.abort();
                stderr.abort();
                let _ = std::fs::remove_dir(&dir);
                return Ok(Exit {
                    success: true,
                    stderr: String::new(),
                });
            }
        }
        let status = child
            .wait()
            .await
            .map_err(|e| CoreError::Ai(format!("waiting for {}: {e}", program.display())))?;
        let _ = writer.await;
        let stderr = stderr.await.unwrap_or_default();
        let _ = std::fs::remove_dir(&dir);
        Ok(Exit {
            success: status.success(),
            stderr: tail(&String::from_utf8_lossy(&stderr), 600),
        })
    });
    work.await
        .map_err(|_| CoreError::Ai("The AI took too long to answer.".into()))?
}

/// Runs a short command (a status check) and returns its stdout, stderr
/// and whether it succeeded.
pub async fn run_quick(program: &Path, args: &[&str]) -> Result<(bool, String, String)> {
    let out = tokio::time::timeout(
        Duration::from_secs(15),
        Command::new(program)
            .args(args)
            .env("PATH", child_path(program))
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| CoreError::Ai(format!("{} didn't answer", program.display())))?
    .map_err(|e| CoreError::Ai(format!("couldn't start {}: {e}", program.display())))?;
    Ok((
        out.status.success(),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    ))
}

/// Starts a sign-in command (it opens the browser) and returns the
/// running process; dropping it stops the sign-in.
pub fn spawn_login(program: &Path, args: &[&str]) -> Result<tokio::process::Child> {
    Command::new(program)
        .args(args)
        .env("PATH", child_path(program))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| CoreError::Ai(format!("couldn't start {}: {e}", program.display())))
}

/// An empty folder to run in, so the tools find no project files
/// (`CLAUDE.md`, `AGENTS.md`) to read.
fn scratch_dir() -> Result<PathBuf> {
    let dir = std::env::temp_dir().join(format!("mailboat-ai-{}", fastrand::u64(..)));
    std::fs::create_dir_all(&dir)
        .map_err(|e| CoreError::Ai(format!("couldn't make a working folder: {e}")))?;
    Ok(dir)
}

fn tail(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.len() <= max {
        return s.to_string();
    }
    let mut start = s.len() - max;
    while !s.is_char_boundary(start) {
        start += 1;
    }
    s[start..].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reads_each_line_and_passes_stdin() {
        let mut seen = Vec::new();
        let exit = run_lines(
            Path::new("/bin/sh"),
            &[
                "-c".into(),
                "while read l; do echo \"got $l\"; done; echo oops >&2".into(),
            ],
            "one\ntwo\n",
            |line| {
                seen.push(line.to_string());
                Ok(ControlFlow::Continue(()))
            },
        )
        .await
        .unwrap();
        assert_eq!(seen, ["got one", "got two"]);
        assert!(exit.success);
        assert_eq!(exit.stderr, "oops");
    }

    #[tokio::test]
    async fn an_error_from_a_line_stops_the_program() {
        let result = run_lines(
            Path::new("/bin/sh"),
            &["-c".into(), "echo a; sleep 30; echo b".into()],
            "",
            |_| Err(CoreError::Ai("stop".into())),
        )
        .await;
        assert!(matches!(result, Err(CoreError::Ai(m)) if m == "stop"));
    }

    #[tokio::test]
    async fn the_last_line_stops_the_program_without_waiting_for_it() {
        let started = std::time::Instant::now();
        let mut seen = Vec::new();
        let exit = run_lines(
            Path::new("/bin/sh"),
            &[
                "-c".into(),
                "echo answer; echo done; sleep 30; echo late".into(),
            ],
            "",
            |line| {
                seen.push(line.to_string());
                Ok(if line == "done" {
                    ControlFlow::Break(())
                } else {
                    ControlFlow::Continue(())
                })
            },
        )
        .await
        .unwrap();
        assert_eq!(seen, ["answer", "done"]);
        assert!(exit.success);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn tail_keeps_the_end_on_a_char_boundary() {
        assert_eq!(tail("  short ", 10), "short");
        assert_eq!(tail("ééééé", 3), "é");
    }
}

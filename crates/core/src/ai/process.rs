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
/// Folders in the home folder the Claude and Codex installers use.
const INSTALLER_DIRS: &[&str] = &[
    ".local/bin",
    ".claude/local",
    ".bun/bin",
    ".npm-global/bin",
    ".volta/bin",
    ".cargo/bin",
];

fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    if let Some(home) = std::env::var_os(home_var).map(PathBuf::from) {
        for rel in INSTALLER_DIRS {
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

/// What a provider's program gets from the app's environment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Env {
    /// Everything (Claude, Apple's helper).
    Inherit,
    /// Only `MINIMAL_VARS` and PATH: nothing else the app was started with
    /// (Codex, which can't promise no tools).
    Minimal,
}

/// What `Env::Minimal` keeps: where home and temp are, the language, the
/// proxy and certificates the network may need, Codex's own folder, and
/// what Windows programs expect. Absent ones are skipped.
const MINIMAL_VARS: &[&str] = &[
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "CODEX_HOME",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "all_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "USERPROFILE",
    "USERNAME",
    "APPDATA",
    "LOCALAPPDATA",
    "ProgramData",
    "ProgramFiles",
    "SystemRoot",
    "SystemDrive",
    "windir",
    "TEMP",
    "TMP",
    "PATHEXT",
    "HOMEDRIVE",
    "HOMEPATH",
    "COMSPEC",
];

/// The macOS sandbox profile `Env::Minimal` runs a program in: no reading
/// or writing anything in the home folder, except Codex's own folder (its
/// sign-in) and, read-only, the folders its program and PATH tools live
/// in. The network stays (Codex needs OpenAI). macOS enforces it, whatever
/// tools Codex offers, so a tool that reads files can't reach the owner's
/// (Milestone 13, Codex fenced in). It also keeps the owner's skills out.
pub fn fence_profile(home: &Path, codex_home: &Path, readable: &[PathBuf]) -> String {
    let quote = |p: &Path| {
        p.to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
    };
    let mut profile = format!(
        "(version 1)\n(allow default)\n\
         (deny file-read* file-write* (subpath \"{home}\"))\n\
         (allow file-read* file-write* (subpath \"{codex}\"))\n",
        home = quote(home),
        codex = quote(codex_home),
    );
    for dir in readable {
        profile.push_str(&format!(
            "(allow file-read* (subpath \"{}\"))\n",
            quote(dir)
        ));
    }
    // Seeing that a file exists (not reading it) is needed to start at all.
    profile.push_str("(allow file-read-metadata)\n");
    profile
}

/// The fence's profile for these folders, or why there can't be one.
/// Code review R6-03: without a home folder, or with Codex's folder at or
/// above it, there's no safe fence and the program doesn't run; and only
/// the installers' folders and the program's own package are readable in
/// the home folder, not every PATH folder (a PATH entry like `~/Documents`
/// would open it). Paths are as the caller found them (canonical).
pub fn fence_for(
    home: Option<&Path>,
    codex_home: Option<&Path>,
    package: Option<&Path>,
    path_dirs: &[PathBuf],
    installers: &[PathBuf],
) -> Result<String> {
    let home = home.ok_or_else(|| {
        CoreError::Ai("Couldn't find the home folder, so the AI can't be fenced in.".into())
    })?;
    let codex_home = codex_home.map_or_else(|| home.join(".codex"), Path::to_path_buf);
    if home.starts_with(&codex_home) {
        return Err(CoreError::Ai(
            "Codex's folder (CODEX_HOME) is the home folder or above it, so it can't be fenced in."
                .into(),
        ));
    }
    let mut readable: Vec<PathBuf> = Vec::new();
    for dir in package
        .into_iter()
        .map(Path::to_path_buf)
        .chain(path_dirs.iter().cloned())
    {
        // Home or above it would open all of home; inside home, only the
        // installers' folders and the program's package.
        let allowed = !home.starts_with(&dir)
            && (!dir.starts_with(home)
                || installers.contains(&dir)
                || package.is_some_and(|p| p == dir));
        if allowed && !readable.contains(&dir) {
            readable.push(dir);
        }
    }
    Ok(fence_profile(home, &codex_home, &readable))
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
    on_line: impl FnMut(&str) -> Result<ControlFlow<()>>,
) -> Result<Exit> {
    run_lines_with(program, args, stdin, Env::Inherit, on_line).await
}

/// `run_lines` with a choice of what the program inherits.
pub async fn run_lines_with(
    program: &Path,
    args: &[String],
    stdin: &str,
    env: Env,
    on_line: impl FnMut(&str) -> Result<ControlFlow<()>>,
) -> Result<Exit> {
    let stop = tokio::time::sleep(TIMEOUT);
    run_lines_until(stop, program, args, stdin, env, on_line).await
}

/// A program running in its working folder. The folder goes only after
/// the program has exited: on Windows a running program's working folder
/// can't be deleted, and `TempDir` doesn't try again. When the request
/// ends before the program was waited on (an error, a timeout, or the
/// caller giving up), dropping this stops the program, waits for it, and
/// then removes the folder, in a task of its own.
struct Running {
    child: Option<tokio::process::Child>,
    dir: Option<tempfile::TempDir>,
    /// The program has been waited on: only the folder is left to go.
    reaped: bool,
}

impl Drop for Running {
    fn drop(&mut self) {
        let (child, dir) = (self.child.take(), self.dir.take());
        let Some(mut child) = child.filter(|_| !self.reaped) else {
            return;
        };
        match tokio::runtime::Handle::try_current() {
            Ok(runtime) => {
                runtime.spawn(async move {
                    let _ = child.kill().await;
                    drop(dir);
                });
            }
            // No runtime to wait in (never in the app): stop it, and
            // remove what can be removed.
            Err(_) => {
                let _ = child.start_kill();
                drop(dir);
            }
        }
    }
}

/// `run_lines_with`, giving up when `stop` completes (`TIMEOUT` in the
/// app; a test can stop it when it chooses).
async fn run_lines_until(
    stop: impl std::future::Future<Output = ()>,
    program: &Path,
    args: &[String],
    stdin: &str,
    env: Env,
    mut on_line: impl FnMut(&str) -> Result<ControlFlow<()>>,
) -> Result<Exit> {
    let work = async {
        let dir = scratch_dir()?;
        let child = command(program, env)?
            .args(args)
            .current_dir(dir.path())
            .env("PATH", child_path(program))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| CoreError::Ai(format!("couldn't start {}: {e}", program.display())))?;
        let mut running = Running {
            child: Some(child),
            dir: Some(dir),
            reaped: false,
        };
        let child = running.child.as_mut().expect("just set");
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
                running.reaped = child.wait().await.is_ok();
                writer.abort();
                stderr.abort();
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
        running.reaped = true;
        let _ = writer.await;
        let stderr = stderr.await.unwrap_or_default();
        Ok(Exit {
            success: status.success(),
            stderr: tail(&String::from_utf8_lossy(&stderr), 600),
        })
    };
    tokio::select! {
        done = work => done,
        () = stop => Err(CoreError::Ai("The AI took too long to answer.".into())),
    }
}

/// Runs a short command (a status check) and returns its stdout, stderr
/// and whether it succeeded.
pub async fn run_quick(program: &Path, args: &[&str]) -> Result<(bool, String, String)> {
    run_quick_with(program, args, Env::Inherit).await
}

/// `run_quick` with a choice of what the program inherits. With
/// `Env::Minimal` it runs in an empty folder of its own (`scratch_dir`),
/// not the app's or the shared temp folder, where another program could
/// have left files for it to read (Semgrep's review).
pub async fn run_quick_with(
    program: &Path,
    args: &[&str],
    env: Env,
) -> Result<(bool, String, String)> {
    run_quick_within(Duration::from_secs(15), program, args, env).await
}

/// `run_quick_with`, giving up after `limit` (15 seconds in the app; tests
/// use less). The program and its folder are held by `Running`, so however
/// this ends (an answer, the time limit, or the caller giving up) the
/// folder goes only after the program has stopped (review: on Windows a
/// running program's working folder can't be deleted).
async fn run_quick_within(
    limit: Duration,
    program: &Path,
    args: &[&str],
    env: Env,
) -> Result<(bool, String, String)> {
    let mut cmd = command(program, env)?;
    let dir = if env == Env::Minimal {
        let dir = scratch_dir()?;
        cmd.current_dir(dir.path());
        Some(dir)
    } else {
        None
    };
    let mut child = cmd
        .args(args)
        .env("PATH", child_path(program))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| CoreError::Ai(format!("couldn't start {}: {e}", program.display())))?;
    let (out, err) = (child.stdout.take(), child.stderr.take());
    let mut running = Running {
        child: Some(child),
        dir,
        reaped: false,
    };
    let (Some(child), Some(mut out), Some(mut err)) = (running.child.as_mut(), out, err) else {
        return Err(CoreError::Ai(format!(
            "couldn't read {}",
            program.display()
        )));
    };
    let work = async {
        let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
        let (read_out, read_err, status) = tokio::join!(
            out.read_to_end(&mut stdout),
            err.read_to_end(&mut stderr),
            child.wait()
        );
        let status =
            status.map_err(|e| CoreError::Ai(format!("waiting for {}: {e}", program.display())))?;
        read_out
            .and(read_err)
            .map_err(|e| CoreError::Ai(format!("reading {}: {e}", program.display())))?;
        Ok::<_, CoreError>((status, stdout, stderr))
    };
    let (status, stdout, stderr) = tokio::time::timeout(limit, work)
        .await
        .map_err(|_| CoreError::Ai(format!("{} didn't answer", program.display())))??;
    running.reaped = true;
    Ok((
        status.success(),
        String::from_utf8_lossy(&stdout).into_owned(),
        String::from_utf8_lossy(&stderr).into_owned(),
    ))
}

/// Starts a sign-in command (it opens the browser) and returns the
/// running process; dropping it stops the sign-in.
pub fn spawn_login(program: &Path, args: &[&str]) -> Result<tokio::process::Child> {
    command(program, Env::Inherit)?
        .args(args)
        .env("PATH", child_path(program))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| CoreError::Ai(format!("couldn't start {}: {e}", program.display())))
}

/// A command for `program` that, on Windows, opens no console window: a
/// windowed app starting a command-line tool otherwise gets one flashing
/// up for every request.
fn command(program: &Path, env: Env) -> Result<Command> {
    let fenced = match env {
        Env::Minimal => fence(program)?,
        Env::Inherit => None,
    };
    let mut cmd = match fenced {
        Some(profile) => {
            let mut c = Command::new("/usr/bin/sandbox-exec");
            c.arg("-p").arg(profile).arg(program);
            c
        }
        None => Command::new(program),
    };
    if env == Env::Minimal {
        cmd.env_clear();
        for var in MINIMAL_VARS {
            if let Some(value) = std::env::var_os(var) {
                cmd.env(var, value);
            }
        }
    }
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    Ok(cmd)
}

/// The fence for `Env::Minimal` on macOS; none elsewhere (Windows has no
/// equivalent: there, reading files depends on Codex offering no tool
/// that does).
fn fence(program: &Path) -> Result<Option<String>> {
    if !cfg!(target_os = "macos") {
        return Ok(None);
    }
    let real = |p: PathBuf| std::fs::canonicalize(&p).unwrap_or(p);
    let home = std::env::var_os("HOME").map(|h| real(PathBuf::from(h)));
    let codex_home = std::env::var_os("CODEX_HOME").map(|c| real(PathBuf::from(c)));
    let package = std::fs::canonicalize(program)
        .ok()
        .and_then(|p| p.parent().and_then(Path::parent).map(Path::to_path_buf));
    let path_dirs: Vec<PathBuf> = search_dirs().into_iter().map(real).collect();
    let installers: Vec<PathBuf> = home
        .iter()
        .flat_map(|h| INSTALLER_DIRS.iter().map(move |rel| real(h.join(rel))))
        .collect();
    fence_for(
        home.as_deref(),
        codex_home.as_deref(),
        package.as_deref(),
        &path_dirs,
        &installers,
    )
    .map(Some)
}

/// An empty folder to run in, so the tools find no project files
/// (`CLAUDE.md`, `AGENTS.md`) to read. Made in one step with a name no
/// other program can claim first, readable by this user only (0700), and
/// removed with anything written in it when dropped: whether the program
/// answered, failed to start or to be read, or the request timed out
/// (the timeout drops the work that holds it).
fn scratch_dir() -> Result<tempfile::TempDir> {
    let mut builder = tempfile::Builder::new();
    builder.prefix("ai-helper-");
    // tempfile leaves a folder's mode to the umask (often 0755).
    #[cfg(unix)]
    builder.permissions(std::os::unix::fs::PermissionsExt::from_mode(0o700));
    builder
        .tempdir()
        .map_err(|e| CoreError::Ai(format!("couldn't make a working folder: {e}")))
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

    // Needs a Unix shell or path rules (/bin/sh, /usr/bin/env, /Users/…).
    #[cfg(unix)]
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

    /// Codex gets only what it needs from the app's environment, not
    /// whatever the app was started with (code review Round 5).
    // Needs a Unix shell or path rules (/bin/sh, /usr/bin/env, /Users/…).
    #[cfg(unix)]
    #[tokio::test]
    async fn a_minimal_environment_keeps_only_whats_needed() {
        std::env::set_var("AI_ENV_PROBE_SECRET", "x");
        let (_, inherited, _) = run_quick(Path::new("/usr/bin/env"), &[]).await.unwrap();
        assert!(inherited.contains("AI_ENV_PROBE_SECRET="));
        let (_, minimal, _) = run_quick_with(Path::new("/usr/bin/env"), &[], Env::Minimal)
            .await
            .unwrap();
        assert!(!minimal.contains("AI_ENV_PROBE_SECRET="), "{minimal}");
        assert!(minimal.contains("HOME="), "{minimal}");
        assert!(minimal.contains("PATH="), "{minimal}");
    }

    /// Milestone 13, Codex fenced in: inside the fence a program can't
    /// read the home folder, but can read Codex's own folder and what's
    /// outside home. A stand-in home, so nothing touches the real one.
    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn the_fence_keeps_a_program_out_of_the_home_folder() {
        let home = std::fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("fence-home-{}", fastrand::u64(..)));
        let codex = home.join(".codex");
        std::fs::create_dir_all(&codex).unwrap();
        std::fs::write(home.join("private.txt"), "PRIVATE").unwrap();
        std::fs::write(codex.join("auth.json"), "SIGN-IN").unwrap();
        let profile = fence_profile(&home, &codex, &[]);
        let cat = |file: PathBuf| {
            let profile = profile.clone();
            async move {
                tokio::process::Command::new("/usr/bin/sandbox-exec")
                    .args(["-p", &profile, "/bin/cat"])
                    .arg(file)
                    .output()
                    .await
                    .unwrap()
            }
        };
        let private = cat(home.join("private.txt")).await;
        assert!(!private.status.success());
        assert!(!String::from_utf8_lossy(&private.stdout).contains("PRIVATE"));
        let own = cat(codex.join("auth.json")).await;
        assert_eq!(String::from_utf8_lossy(&own.stdout), "SIGN-IN");
        assert!(cat("/etc/hosts".into()).await.status.success());
        let _ = std::fs::remove_dir_all(&home);
    }

    /// Codex's runs (`Env::Minimal`) go through the fence on macOS; other
    /// programs don't.
    #[cfg(target_os = "macos")]
    #[test]
    fn minimal_runs_are_fenced() {
        let fenced = command(Path::new("/bin/cat"), Env::Minimal).unwrap();
        assert_eq!(fenced.as_std().get_program(), "/usr/bin/sandbox-exec");
        let plain = command(Path::new("/bin/cat"), Env::Inherit).unwrap();
        assert_eq!(plain.as_std().get_program(), "/bin/cat");
    }

    /// Code review R6-03: no fence without a home folder, none when
    /// Codex's folder is home or above it, and no arbitrary PATH folder
    /// inside home made readable.
    // Needs a Unix shell or path rules (/bin/sh, /usr/bin/env, /Users/…).
    #[cfg(unix)]
    #[test]
    fn the_fence_refuses_what_would_open_the_home_folder() {
        let home = Path::new("/Users/someone");
        let docs = home.join("Documents");
        let local = home.join(".local/bin");
        let package = home.join(".codex/packages/x");
        assert!(fence_for(None, None, None, &[], &[]).is_err(), "no home");
        assert!(
            fence_for(Some(home), Some(home), None, &[], &[]).is_err(),
            "CODEX_HOME = home"
        );
        assert!(
            fence_for(Some(home), Some(Path::new("/Users")), None, &[], &[]).is_err(),
            "CODEX_HOME above home"
        );
        let p = fence_for(
            Some(home),
            None,
            Some(&package),
            &[
                docs.clone(),
                local.clone(),
                "/usr/bin".into(),
                home.to_path_buf(),
            ],
            std::slice::from_ref(&local),
        )
        .unwrap();
        assert!(!p.contains("Documents"), "{p}");
        assert!(
            p.contains("(allow file-read* (subpath \"/Users/someone/.local/bin\"))"),
            "{p}"
        );
        assert!(
            p.contains("(allow file-read* (subpath \"/usr/bin\"))"),
            "{p}"
        );
        assert!(p.contains(".codex/packages/x"), "{p}");
        assert!(
            !p.contains("(allow file-read* (subpath \"/Users/someone\"))"),
            "{p}"
        );
    }

    #[test]
    fn the_fence_profile_quotes_paths() {
        let p = fence_profile(
            Path::new("/Users/a \"b\""),
            Path::new("/c"),
            &[PathBuf::from("/d")],
        );
        assert!(
            p.contains("(deny file-read* file-write* (subpath \"/Users/a \\\"b\\\"\"))"),
            "{p}"
        );
        assert!(p.contains("(allow file-read* (subpath \"/d\"))"), "{p}");
    }

    /// What the program says about its working folder (its path and
    /// `ls -ld`), after writing a file into it.
    #[cfg(unix)]
    const SHOW_FOLDER: &str = "touch left-behind; pwd -P; ls -ld . | cut -c1-10";

    /// Whether `folder` is gone within a few seconds: after an error or a
    /// timeout, it goes once the program has been stopped and waited on,
    /// in a task of its own.
    #[cfg(unix)]
    async fn goes(folder: &Path) -> bool {
        for _ in 0..100 {
            if !folder.exists() {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        false
    }

    /// The working folder is private, and gone afterwards with what the
    /// program wrote in it, on each way out of `run_lines_with`: the
    /// program exiting, the answer coming in before it exits, and a line
    /// handler failing. (A program that can't start leaves its folder to
    /// the same drop.)
    #[cfg(unix)]
    #[tokio::test]
    async fn the_working_folder_is_private_and_removed_on_every_way_out() {
        for way in ["exit", "answer", "error"] {
            let script = match way {
                "exit" => SHOW_FOLDER.to_string(),
                // `exec`, so stopping the program stops the sleep too.
                _ => format!("{SHOW_FOLDER}; echo done; exec sleep 30"),
            };
            let mut seen = Vec::new();
            let result = run_lines(Path::new("/bin/sh"), &["-c".into(), script], "", |line| {
                seen.push(line.to_string());
                match (way, line) {
                    ("answer", "done") => Ok(ControlFlow::Break(())),
                    ("error", "done") => Err(CoreError::Ai("stop".into())),
                    _ => Ok(ControlFlow::Continue(())),
                }
            })
            .await;
            assert_eq!(result.is_ok(), way != "error", "{way}");
            let folder = PathBuf::from(&seen[0]);
            assert!(
                folder
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("ai-helper-"),
                "{way}: {folder:?}"
            );
            assert_eq!(seen[1], "drwx------", "{way}: only this user");
            assert!(goes(&folder).await, "{way}: {folder:?} is left behind");
        }
    }

    /// Timing out stops the program and removes the folder. The test
    /// times it out once the program has shown its folder, so how fast the
    /// program starts doesn't matter.
    #[cfg(unix)]
    #[tokio::test]
    async fn the_working_folder_is_removed_when_the_request_times_out() {
        let (shown, stop) = tokio::sync::oneshot::channel::<()>();
        let mut shown = Some(shown);
        let mut seen = Vec::new();
        let result = run_lines_until(
            async {
                let _ = stop.await;
            },
            Path::new("/bin/sh"),
            // Its process ID, then `exec`, so the sleep is that process.
            &[
                "-c".into(),
                format!("{SHOW_FOLDER}; echo $$; exec sleep 600"),
            ],
            "",
            Env::Inherit,
            |line| {
                seen.push(line.to_string());
                if seen.len() == 3 {
                    shown.take().map(|s| s.send(()));
                }
                Ok(ControlFlow::Continue(()))
            },
        )
        .await;
        assert!(matches!(result, Err(CoreError::Ai(m)) if m.contains("too long")));
        let folder = PathBuf::from(&seen[0]);
        assert!(goes(&folder).await, "{folder:?} is left behind");
        // Gone only once the program had stopped.
        let alive = std::process::Command::new("kill")
            .args(["-0", &seen[2]])
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success();
        assert!(!alive, "the program was still running");
    }

    /// A quick command that times out is stopped before its folder is
    /// removed, and the folder goes (review: on Windows a running
    /// program's folder can't be deleted).
    #[cfg(unix)]
    #[tokio::test]
    async fn a_quick_command_that_times_out_is_stopped_and_its_folder_removed() {
        let note = tempfile::NamedTempFile::new().unwrap();
        let script = format!(
            "pwd -P > '{0}'; echo $$ >> '{0}'; exec sleep 600",
            note.path().display()
        );
        let result = run_quick_within(
            Duration::from_secs(1),
            Path::new("/bin/sh"),
            &["-c", &script],
            Env::Minimal,
        )
        .await;
        assert!(matches!(result, Err(CoreError::Ai(m)) if m.contains("didn't answer")));
        let text = std::fs::read_to_string(note.path()).unwrap();
        let mut lines = text.lines();
        let folder = PathBuf::from(lines.next().unwrap());
        let pid = lines.next().unwrap().trim().to_string();
        assert!(goes(&folder).await, "{folder:?} is left behind");
        let alive = std::process::Command::new("kill")
            .args(["-0", &pid])
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success();
        assert!(!alive, "the program was still running");
    }

    /// A quick command with the minimal environment runs in an empty,
    /// private folder of its own, gone afterwards, not the shared temp
    /// folder (Semgrep's review).
    #[cfg(unix)]
    #[tokio::test]
    async fn a_minimal_quick_command_runs_in_its_own_folder() {
        let (ok, out, _) = run_quick_with(
            Path::new("/bin/sh"),
            &["-c", "pwd -P; ls -A | wc -l; ls -ld . | cut -c1-10"],
            Env::Minimal,
        )
        .await
        .unwrap();
        assert!(ok);
        let lines: Vec<&str> = out.lines().map(str::trim).collect();
        let folder = PathBuf::from(lines[0]);
        assert!(
            folder
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("ai-helper-"),
            "{folder:?}"
        );
        assert_eq!(lines[1], "0", "empty");
        assert_eq!(lines[2], "drwx------", "only this user");
        assert!(!folder.exists(), "{folder:?} is left behind");
    }

    // Needs a Unix shell or path rules (/bin/sh, /usr/bin/env, /Users/…).
    #[cfg(unix)]
    #[tokio::test]
    async fn an_error_from_a_line_stops_the_program() {
        let result = run_lines(
            Path::new("/bin/sh"),
            // `exec`, so stopping the program stops the sleep too.
            &["-c".into(), "echo a; exec sleep 30".into()],
            "",
            |_| Err(CoreError::Ai("stop".into())),
        )
        .await;
        assert!(matches!(result, Err(CoreError::Ai(m)) if m == "stop"));
    }

    // Needs a Unix shell or path rules (/bin/sh, /usr/bin/env, /Users/…).
    #[cfg(unix)]
    #[tokio::test]
    async fn the_last_line_stops_the_program_without_waiting_for_it() {
        let started = std::time::Instant::now();
        let mut seen = Vec::new();
        let exit = run_lines(
            Path::new("/bin/sh"),
            &[
                "-c".into(),
                // `exec`, so stopping the program stops the sleep too.
                "echo answer; echo done; exec sleep 30".into(),
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

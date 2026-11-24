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

/// What the fence opens in the home folder: Codex's own folder (read and
/// write), and the folders its program and PATH tools live in (read only).
#[derive(Debug, PartialEq)]
pub struct FenceDirs {
    pub home: PathBuf,
    pub codex_home: PathBuf,
    pub readable: Vec<PathBuf>,
    /// The app's own folders (mail cache, settings, image cache, logs),
    /// hidden whatever else is opened, wherever they are: on Linux the XDG
    /// folders can be outside home.
    pub hidden: Vec<PathBuf>,
}

/// The fence's folders, or why there can't be a fence.
/// Code review R6-03: without a home folder, or with Codex's folder at or
/// above it, there's no safe fence and the program doesn't run; and only
/// the installers' folders and the program's own package are readable in
/// the home folder, not every PATH folder (a PATH entry like `~/Documents`
/// would open it). Paths are as the caller found them (canonical).
pub fn fence_dirs(
    home: Option<&Path>,
    codex_home: Option<&Path>,
    package: Option<&Path>,
    path_dirs: &[PathBuf],
    installers: &[PathBuf],
) -> Result<FenceDirs> {
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
    Ok(FenceDirs {
        home: home.to_path_buf(),
        codex_home,
        readable,
        hidden: Vec::new(),
    })
}

/// The folder of Codex's own package, read only inside the fence: the
/// program's folder's parent (an npm package's `bin/` sits in it), except
/// when the program's folder is an installer's (`~/.local/bin`): its
/// parent is then a shared folder (`~/.local`, with the app's data in
/// it), so the folder itself, already readable, is the package (second
/// review of the Linux fence).
pub fn package_of(program: &Path, installers: &[PathBuf]) -> Option<PathBuf> {
    let folder = program.parent()?;
    if installers.iter().any(|i| i == folder) {
        return Some(folder.to_path_buf());
    }
    folder.parent().map(Path::to_path_buf)
}

/// The macOS fence's profile for these folders, or why there can't be one.
pub fn fence_for(
    home: Option<&Path>,
    codex_home: Option<&Path>,
    package: Option<&Path>,
    path_dirs: &[PathBuf],
    installers: &[PathBuf],
) -> Result<String> {
    let d = fence_dirs(home, codex_home, package, path_dirs, installers)?;
    Ok(fence_profile(&d.home, &d.codex_home, &d.readable))
}

/// The Linux fence: bubblewrap's arguments, up to the program. The same
/// rule as the macOS profile: the whole system as it is, except the home
/// folder, which is an empty one, with the readable folders inside home
/// (read only) and Codex's folder (read and write, last, so a readable
/// folder above it can't cover it) put back. Then, over everything, the
/// app's own folders are emptied wherever they are, and Codex starts in
/// `workdir`, which is put back too (`TMPDIR` can be inside home). The
/// user's runtime folder is emptied, and the session bus's socket covered
/// where the bus address names one elsewhere: an unlocked desktop keyring
/// hands its secrets to anything on the bus without asking (a bus on an
/// abstract socket can't be hidden without cutting the network, which
/// Codex needs). It has its own process list, so the app's open files
/// can't be reached through `/proc`. Folders that don't exist are left
/// out (bubblewrap can't mount them).
pub fn bwrap_args(
    d: &FenceDirs,
    runtime_dir: Option<&Path>,
    bus_address: Option<&str>,
    workdir: Option<&Path>,
) -> Vec<std::ffi::OsString> {
    use std::ffi::OsString;
    let mut args: Vec<OsString> = BWRAP_BASE.iter().map(OsString::from).collect();
    let mut push = |items: &[&std::ffi::OsStr]| args.extend(items.iter().map(|a| a.to_os_string()));
    if let Some(run) = runtime_dir.filter(|r| r.is_dir()) {
        push(&["--tmpfs".as_ref(), run.as_os_str()]);
    }
    for socket in bus_sockets(bus_address.unwrap_or_default()) {
        let covered =
            runtime_dir.is_some_and(|r| socket.starts_with(r)) || socket.starts_with(&d.home);
        if !covered && socket.exists() {
            push(&[
                "--ro-bind".as_ref(),
                "/dev/null".as_ref(),
                socket.as_os_str(),
            ]);
        }
    }
    push(&["--tmpfs".as_ref(), d.home.as_os_str()]);
    for dir in d
        .readable
        .iter()
        .filter(|r| r.starts_with(&d.home) && r.is_dir())
    {
        push(&["--ro-bind".as_ref(), dir.as_os_str(), dir.as_os_str()]);
    }
    if d.codex_home.is_dir() {
        push(&[
            "--bind".as_ref(),
            d.codex_home.as_os_str(),
            d.codex_home.as_os_str(),
        ]);
    }
    for dir in d.hidden.iter().filter(|h| h.is_dir()) {
        push(&["--tmpfs".as_ref(), dir.as_os_str()]);
    }
    if let Some(work) = workdir.filter(|w| w.is_dir()) {
        push(&["--bind".as_ref(), work.as_os_str(), work.as_os_str()]);
        push(&["--chdir".as_ref(), work.as_os_str()]);
    }
    args
}

/// The app's own folders in these base folders: each entry named `id`
/// (the normal mode's) or starting `id.` (another mode's, such as
/// `id.clean-start`).
pub fn app_folders(bases: &[PathBuf], id: &str) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for base in bases {
        let Ok(entries) = std::fs::read_dir(base) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let ours = name == id || name.starts_with(&format!("{id}."));
            if ours && entry.path().is_dir() && !found.contains(&entry.path()) {
                found.push(entry.path());
            }
        }
    }
    found.sort();
    found
}

/// What every Linux fence starts with, the usability probe included: its
/// own process list, and the system as it is with fresh `/dev` and `/proc`.
pub const BWRAP_BASE: [&str; 9] = [
    "--die-with-parent",
    "--unshare-pid",
    "--bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
];

/// The socket files a D-Bus address names (`unix:path=…`, each of its
/// `;`-separated choices).
pub fn bus_sockets(address: &str) -> Vec<PathBuf> {
    address
        .split(';')
        .filter_map(|choice| choice.strip_prefix("unix:"))
        .flat_map(|keys| keys.split(','))
        .filter_map(|kv| kv.strip_prefix("path="))
        .map(PathBuf::from)
        .collect()
}

/// Bubblewrap, where the distribution installs it (its own AppArmor
/// profile, on Ubuntu, is for this path), if it can make a fence here:
/// asked once, with `true`, since a system can have it installed and
/// still not allow the namespaces it needs. None: Codex runs without a
/// fence, as on Windows.
#[cfg(target_os = "linux")]
fn bubblewrap() -> Option<&'static Path> {
    static USABLE: std::sync::OnceLock<Option<&'static Path>> = std::sync::OnceLock::new();
    *USABLE.get_or_init(|| {
        let bwrap = Path::new("/usr/bin/bwrap");
        // The fence's own namespace and mounts, so a system that allows
        // bubblewrap but not, say, its own process list isn't taken as
        // usable (third review of the Linux fence).
        let ok = std::process::Command::new(bwrap)
            .args(BWRAP_BASE)
            .arg("true")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
        ok.then_some(bwrap)
    })
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
        let child = command(program, env, Some(dir.path()))?
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
    let dir = if env == Env::Minimal {
        Some(scratch_dir()?)
    } else {
        None
    };
    let mut cmd = command(program, env, dir.as_ref().map(|d| d.path()))?;
    if let Some(dir) = &dir {
        cmd.current_dir(dir.path());
    }
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
    command(program, Env::Inherit, None)?
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
/// `workdir` is the folder it starts in, which the fence leaves open.
fn command(program: &Path, env: Env, workdir: Option<&Path>) -> Result<Command> {
    let fenced = match env {
        Env::Minimal => fence(program, workdir)?,
        Env::Inherit => None,
    };
    let mut cmd = match fenced {
        Some(Fence::Seatbelt(profile)) => {
            let mut c = Command::new("/usr/bin/sandbox-exec");
            c.arg("-p").arg(profile).arg(program);
            c
        }
        Some(Fence::Bubblewrap(bwrap, args)) => {
            let mut c = Command::new(bwrap);
            c.args(args).arg(program);
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

/// How `Env::Minimal` is fenced in.
enum Fence {
    /// macOS's sandbox, with this profile.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Seatbelt(String),
    /// Linux's bubblewrap (the program), with these arguments.
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    Bubblewrap(&'static Path, Vec<std::ffi::OsString>),
}

/// The fence for `Env::Minimal`: macOS's sandbox; on Linux, bubblewrap
/// where it's installed and allowed. None elsewhere, or on a Linux without
/// it (Windows has no equivalent: there, reading files depends on Codex
/// offering no tool that does).
#[cfg_attr(not(target_os = "linux"), allow(unused_variables))]
fn fence(program: &Path, workdir: Option<&Path>) -> Result<Option<Fence>> {
    #[cfg(target_os = "linux")]
    let bwrap = match bubblewrap() {
        Some(b) => b,
        None => return Ok(None),
    };
    #[cfg(not(target_os = "linux"))]
    if !cfg!(target_os = "macos") {
        return Ok(None);
    }
    let real = |p: PathBuf| std::fs::canonicalize(&p).unwrap_or(p);
    let home = std::env::var_os("HOME").map(|h| real(PathBuf::from(h)));
    let codex_home = std::env::var_os("CODEX_HOME").map(|c| real(PathBuf::from(c)));
    let path_dirs: Vec<PathBuf> = search_dirs().into_iter().map(real).collect();
    let installers: Vec<PathBuf> = home
        .iter()
        .flat_map(|h| INSTALLER_DIRS.iter().map(move |rel| real(h.join(rel))))
        .collect();
    let package = std::fs::canonicalize(program)
        .ok()
        .and_then(|p| package_of(&p, &installers));
    #[cfg_attr(not(target_os = "linux"), allow(unused_mut))]
    let mut dirs = fence_dirs(
        home.as_deref(),
        codex_home.as_deref(),
        package.as_deref(),
        &path_dirs,
        &installers,
    )?;
    #[cfg(target_os = "linux")]
    {
        // The app's own folders, in the folders Tauri puts them (`dirs`,
        // as it does), whatever the launch mode (Clean Start's sit beside
        // the normal ones).
        let bases: Vec<PathBuf> = [
            dirs::data_dir(),
            dirs::data_local_dir(),
            dirs::config_dir(),
            dirs::cache_dir(),
        ]
        .into_iter()
        .flatten()
        .collect();
        dirs.hidden = app_folders(&bases, crate::brand::ID)
            .into_iter()
            .map(real)
            .collect();
        if dirs.hidden.iter().any(|h| dirs.codex_home.starts_with(h)) {
            return Err(CoreError::Ai(
                "Codex's folder (CODEX_HOME) is inside the app's own folder, so it can't be fenced in."
                    .into(),
            ));
        }
        // Without `$XDG_RUNTIME_DIR`, where systemd puts it: under this
        // user's ID, which owns this process's own `/proc` entry.
        let runtime = std::env::var_os("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .or_else(|| {
                use std::os::unix::fs::MetadataExt;
                let uid = std::fs::metadata("/proc/self").ok()?.uid();
                Some(PathBuf::from(format!("/run/user/{uid}")))
            });
        let bus = std::env::var("DBUS_SESSION_BUS_ADDRESS").ok();
        Ok(Some(Fence::Bubblewrap(
            bwrap,
            bwrap_args(&dirs, runtime.as_deref(), bus.as_deref(), workdir),
        )))
    }
    #[cfg(not(target_os = "linux"))]
    Ok(Some(Fence::Seatbelt(fence_profile(
        &dirs.home,
        &dirs.codex_home,
        &dirs.readable,
    ))))
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
        let fenced = command(Path::new("/bin/cat"), Env::Minimal, None).unwrap();
        assert_eq!(fenced.as_std().get_program(), "/usr/bin/sandbox-exec");
        let plain = command(Path::new("/bin/cat"), Env::Inherit, None).unwrap();
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

    /// The Linux fence: its own process list; the runtime folder and home
    /// emptied; the readable folders inside home put back read only, then
    /// Codex's folder writable (after them, so a readable folder above it
    /// can't cover it); then the app's own folders emptied wherever they are
    /// (after everything, so nothing put back uncovers them); then the
    /// working folder. Folders outside home need nothing, and folders that
    /// don't exist are left out. Real folders in a stand-in home.
    #[test]
    fn the_linux_fence_hides_home_and_the_apps_folders_and_puts_back_what_codex_needs() {
        let root = std::env::temp_dir().join(format!("bwrap-args-{}", fastrand::u64(..)));
        let home = root.join("home");
        let local = home.join(".local");
        let codex = local.join("share/codex");
        let data = local.join("share/app.id");
        let elsewhere = root.join("disk/app.id");
        let work = home.join("tmp/work");
        let run = root.join("run");
        let bus = root.join("bus");
        for d in [&codex, &data, &elsewhere, &work, &run] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(&bus, "").unwrap();
        let dirs = FenceDirs {
            home: home.clone(),
            codex_home: codex.clone(),
            readable: vec![local.clone(), "/usr/bin".into(), home.join("gone")],
            hidden: vec![data.clone(), elsewhere.clone(), root.join("missing")],
        };
        let address = format!("unix:path={};unix:abstract=/tmp/x", bus.display());
        let args: Vec<String> = bwrap_args(&dirs, Some(&run), Some(&address), Some(&work))
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let s = |p: &Path| p.to_string_lossy().into_owned();
        let at = |needle: &[String]| {
            args.windows(needle.len())
                .position(|w| w == needle)
                .unwrap_or_else(|| panic!("{needle:?} not in {args:?}"))
        };
        let base: Vec<String> = BWRAP_BASE.iter().map(|a| a.to_string()).collect();
        assert!(args.starts_with(&base), "the probe's own start: {args:?}");
        at(&["--tmpfs".into(), s(&run)]);
        at(&["--ro-bind".into(), "/dev/null".into(), s(&bus)]);
        let tmpfs_home = at(&["--tmpfs".into(), s(&home)]);
        let local_bind = at(&["--ro-bind".into(), s(&local), s(&local)]);
        let codex_bind = at(&["--bind".into(), s(&codex), s(&codex)]);
        let data_hidden = at(&["--tmpfs".into(), s(&data)]);
        let elsewhere_hidden = at(&["--tmpfs".into(), s(&elsewhere)]);
        let work_bind = at(&["--bind".into(), s(&work), s(&work)]);
        at(&["--chdir".into(), s(&work)]);
        assert!(
            tmpfs_home < local_bind && local_bind < codex_bind,
            "{args:?}"
        );
        assert!(
            codex_bind < data_hidden && codex_bind < elsewhere_hidden,
            "{args:?}"
        );
        assert!(data_hidden < work_bind, "{args:?}");
        assert!(
            !args.iter().any(|a| a == "/usr/bin"),
            "outside home needs nothing: {args:?}"
        );
        assert!(
            !args
                .iter()
                .any(|a| a.ends_with("gone") || a.ends_with("missing")),
            "{args:?}"
        );
        assert!(
            !args.iter().any(|a| a == "--unshare-net"),
            "network stays: {args:?}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Code review (Linux fence, round 2): a program right in an
    /// installer's folder (`~/.local/bin/codex`) makes that folder its
    /// package, not `~/.local`, which holds the app's data; an npm
    /// package's `bin/` still gives the package.
    #[test]
    fn a_program_in_an_installers_folder_is_its_own_package() {
        let local_bin = PathBuf::from("/home/someone/.local/bin");
        let installers = vec![local_bin.clone()];
        assert_eq!(
            package_of(&local_bin.join("codex"), &installers),
            Some(local_bin.clone())
        );
        assert_eq!(
            package_of(
                Path::new("/home/someone/.npm-global/lib/node_modules/codex/bin/codex.js"),
                &installers
            ),
            Some(PathBuf::from(
                "/home/someone/.npm-global/lib/node_modules/codex"
            ))
        );
    }

    /// Every mode's folders are the app's: the normal one and Clean
    /// Start's beside it, but not another app's that only starts alike.
    #[test]
    fn finds_the_apps_folders_of_every_mode() {
        let root = std::env::temp_dir().join(format!("app-folders-{}", fastrand::u64(..)));
        let data = root.join("share");
        let config = root.join("config");
        for d in [
            data.join("app.id"),
            data.join("app.id.clean-start"),
            data.join("app.idea"),
            config.join("app.id"),
        ] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(data.join("app.id.txt"), "").unwrap();
        assert_eq!(
            app_folders(&[data.clone(), config.clone(), root.join("none")], "app.id"),
            [
                config.join("app.id"),
                data.join("app.id"),
                data.join("app.id.clean-start"),
            ]
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reads_the_socket_files_a_bus_address_names() {
        assert_eq!(
            bus_sockets("unix:path=/run/user/1000/bus"),
            [PathBuf::from("/run/user/1000/bus")]
        );
        assert_eq!(
            bus_sockets("unix:abstract=/tmp/dbus-x,guid=1;unix:path=/tmp/b,guid=2"),
            [PathBuf::from("/tmp/b")]
        );
        assert!(bus_sockets("").is_empty());
    }

    /// On Linux with bubblewrap: inside the fence a program can't read the
    /// home folder, nor the app's folders even under a readable folder or
    /// outside home, but can read Codex's own folder and what's outside
    /// home, starts in its working folder (here inside home, as with a
    /// `TMPDIR` there), and sees its own processes only. A stand-in home,
    /// so nothing touches the real one. Skipped (with a note) where
    /// bubblewrap can't make a fence; CI installs it.
    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn the_linux_fence_keeps_a_program_out_of_the_home_folder() {
        let Some(bwrap) = bubblewrap() else {
            assert!(std::env::var_os("CI").is_none(), "CI installs bubblewrap");
            eprintln!("skipped: bubblewrap can't make a fence here");
            return;
        };
        let root = std::env::temp_dir().join(format!("fence-{}", fastrand::u64(..)));
        let home = root.join("home");
        let local = home.join(".local");
        let codex = home.join(".codex");
        let data = local.join("share/app.id");
        let elsewhere = root.join("disk/app.id");
        let work = home.join("tmp/work");
        for d in [&codex, &data, &elsewhere, &work] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(home.join("private.txt"), "PRIVATE").unwrap();
        std::fs::write(codex.join("auth.json"), "SIGN-IN").unwrap();
        std::fs::write(local.join("tool.txt"), "TOOL").unwrap();
        std::fs::write(data.join("mail.sqlite3"), "MAIL").unwrap();
        std::fs::write(elsewhere.join("mail.sqlite3"), "MAIL").unwrap();
        let dirs = FenceDirs {
            home: home.clone(),
            codex_home: codex.clone(),
            readable: vec![local.clone()],
            hidden: vec![data.clone(), elsewhere.clone()],
        };
        let args = bwrap_args(&dirs, None, None, Some(&work));
        let run = |program: &'static str, arg: Option<PathBuf>| {
            let args = args.clone();
            async move {
                let mut c = tokio::process::Command::new(bwrap);
                c.args(args).arg(program);
                if let Some(arg) = arg {
                    c.arg(arg);
                }
                let o = c.output().await.unwrap();
                String::from_utf8_lossy(&o.stdout).into_owned()
            }
        };
        let cat = |file: PathBuf| run("/bin/cat", Some(file));
        assert!(!cat(home.join("private.txt")).await.contains("PRIVATE"));
        assert!(!cat(data.join("mail.sqlite3")).await.contains("MAIL"));
        assert!(!cat(elsewhere.join("mail.sqlite3")).await.contains("MAIL"));
        assert_eq!(cat(local.join("tool.txt")).await, "TOOL");
        assert_eq!(cat(codex.join("auth.json")).await, "SIGN-IN");
        assert!(!cat("/etc/hosts".into()).await.is_empty());
        assert_eq!(run("/bin/pwd", None).await.trim(), work.to_string_lossy());
        // Its own process list: this test's process isn't in it.
        let me = std::process::id().to_string();
        assert!(!run("/bin/ls", Some("/proc".into()))
            .await
            .lines()
            .any(|l| l == me));
        let _ = std::fs::remove_dir_all(&root);
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

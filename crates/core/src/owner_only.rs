//! Folders and files only this user can open (DASA 1.9.1).
//!
//! On macOS and Linux: folders 0700, files 0600. A folder or file made by
//! an earlier version keeps the mode it was made with until it is set, so
//! startup sets them again. macOS already keeps `~/Library` private; Linux
//! doesn't keep `~/.local/share` so.
//!
//! On Windows the app's folders sit in the user's own profile and take its
//! permissions. The Google client file, which holds the OAuth client
//! secret, gets an access list of its own instead (`file`): this user
//! alone, not inherited from the folder.

use std::path::Path;

/// Makes `dir` and any missing parents, then makes `dir` itself (not its
/// parents) this user's only (0700 on macOS and Linux; on Windows it keeps
/// what it inherits from the user's profile).
pub fn dir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Makes the file at `path`, if it's there, this user's only: 0600 on
/// macOS and Linux, an access list for this user alone on Windows. A file
/// that isn't there is fine. A link is left alone (and so is what it
/// points at): the app makes none, so one there wasn't the app's.
pub fn file(path: &Path) -> std::io::Result<()> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_file() => restrict(path),
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Sets the mode through an opened file, not the path, so a link swapped
/// in between the check and here isn't followed (`O_NOFOLLOW`).
#[cfg(unix)]
fn restrict(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)?;
    file.set_permissions(std::fs::Permissions::from_mode(0o600))
}

#[cfg(windows)]
fn restrict(path: &Path) -> std::io::Result<()> {
    windows::owner_only(path)
}

#[cfg(not(any(unix, windows)))]
fn restrict(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Windows' access lists: a protected list (nothing inherited from the
/// folder) that lets this user, by their account's SID, do anything, and
/// nobody else anything.
#[cfg(windows)]
pub(crate) mod windows {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, ERROR_SUCCESS, HANDLE};
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        SetNamedSecurityInfoW, SDDL_REVISION_1, SE_FILE_OBJECT,
    };
    use windows_sys::Win32::Security::{
        GetSecurityDescriptorDacl, GetTokenInformation, TokenUser, ACL, DACL_SECURITY_INFORMATION,
        PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn last_error() -> std::io::Error {
        std::io::Error::last_os_error()
    }

    /// This user's SID as text (`S-1-5-21-…`).
    pub(crate) fn user_sid() -> std::io::Result<String> {
        // SAFETY: each call gets valid pointers to locals or to a buffer
        // of the size Windows asked for; the token handle and the string
        // Windows allocates are freed before returning.
        unsafe {
            let mut token: HANDLE = std::ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return Err(last_error());
            }
            let mut len = 0u32;
            GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut len);
            let mut buf = vec![0u8; len as usize];
            let ok = GetTokenInformation(token, TokenUser, buf.as_mut_ptr().cast(), len, &mut len);
            CloseHandle(token);
            if ok == 0 {
                return Err(last_error());
            }
            let user = &*(buf.as_ptr() as *const TOKEN_USER);
            let mut text: *mut u16 = std::ptr::null_mut();
            if ConvertSidToStringSidW(user.User.Sid, &mut text) == 0 {
                return Err(last_error());
            }
            let n = (0..).take_while(|&i| *text.add(i) != 0).count();
            let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, n));
            LocalFree(text.cast());
            Ok(sid)
        }
    }

    /// The access list described above, set on `path`.
    pub(crate) fn owner_only(path: &Path) -> std::io::Result<()> {
        let sddl = wide(&format!("D:P(A;;FA;;;{})", user_sid()?));
        let target: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        // SAFETY: the descriptor Windows builds from the SDDL text is
        // freed once its access list has been applied; the list points
        // into it, so it isn't used after.
        unsafe {
            let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                std::ptr::null_mut(),
            ) == 0
            {
                return Err(last_error());
            }
            let (mut present, mut defaulted) = (0, 0);
            let mut dacl: *mut ACL = std::ptr::null_mut();
            let got =
                GetSecurityDescriptorDacl(descriptor, &mut present, &mut dacl, &mut defaulted);
            let status = if got == 0 {
                Err(last_error())
            } else {
                match SetNamedSecurityInfoW(
                    target.as_ptr(),
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    dacl,
                    std::ptr::null(),
                ) {
                    ERROR_SUCCESS => Ok(()),
                    code => Err(std::io::Error::from_raw_os_error(code as i32)),
                }
            };
            LocalFree(descriptor);
            status
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "owner-only-{name}-{}-{}",
            std::process::id(),
            fastrand::u32(..)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[cfg(unix)]
    fn mode(path: &Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    /// A folder made now, and one an earlier version made open, both end
    /// up 0700; its parents are left as they were.
    #[cfg(unix)]
    #[test]
    fn folders_become_this_users_only() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp("dir");
        let inner = root.join("inner");
        dir(&inner).unwrap();
        assert_eq!(mode(&inner), 0o700);
        std::fs::set_permissions(&inner, std::fs::Permissions::from_mode(0o755)).unwrap();
        dir(&inner).unwrap();
        assert_eq!(mode(&inner), 0o700);
        assert_ne!(mode(&root), 0o700, "a parent keeps its own mode");
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// An open file becomes 0600; a missing one is fine; a link is left
    /// alone, and so is what it points at.
    #[cfg(unix)]
    #[test]
    fn files_become_this_users_only_but_links_are_left_alone() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp("file");
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("a.json");
        std::fs::write(&path, "{}").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        file(&path).unwrap();
        assert_eq!(mode(&path), 0o600);
        file(&root.join("missing.json")).unwrap();

        let elsewhere = root.join("elsewhere.txt");
        std::fs::write(&elsewhere, "x").unwrap();
        std::fs::set_permissions(&elsewhere, std::fs::Permissions::from_mode(0o644)).unwrap();
        let link = root.join("link.json");
        std::os::unix::fs::symlink(&elsewhere, &link).unwrap();
        file(&link).unwrap();
        assert_eq!(mode(&elsewhere), 0o644);
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// On Windows the file's access list is protected (nothing inherited)
    /// and names this user alone, with full access.
    #[cfg(windows)]
    #[test]
    fn files_get_an_access_list_for_this_user_alone() {
        let root = temp("acl");
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("a.json");
        std::fs::write(&path, "{}").unwrap();
        file(&path).unwrap();
        let sid = windows::user_sid().unwrap();
        assert_eq!(read_dacl(&path), format!("D:P(A;;FA;;;{sid})"));
        // Still this user's to read and write.
        std::fs::write(&path, "{\"a\":1}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":1}");
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// The file's access list as SDDL text.
    #[cfg(windows)]
    pub(crate) fn read_dacl(path: &Path) -> String {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Foundation::{LocalFree, ERROR_SUCCESS};
        use windows_sys::Win32::Security::Authorization::{
            ConvertSecurityDescriptorToStringSecurityDescriptorW, GetNamedSecurityInfoW,
            SDDL_REVISION_1, SE_FILE_OBJECT,
        };
        use windows_sys::Win32::Security::{DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR};
        let target: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        // SAFETY: valid pointers to locals; both buffers Windows allocates
        // are freed before returning.
        unsafe {
            let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
            let status = GetNamedSecurityInfoW(
                target.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut descriptor,
            );
            assert_eq!(status, ERROR_SUCCESS);
            let mut text: *mut u16 = std::ptr::null_mut();
            let mut len = 0u32;
            assert_ne!(
                ConvertSecurityDescriptorToStringSecurityDescriptorW(
                    descriptor,
                    SDDL_REVISION_1,
                    DACL_SECURITY_INFORMATION,
                    &mut text,
                    &mut len,
                ),
                0
            );
            let n = (0..).take_while(|&i| *text.add(i) != 0).count();
            let sddl = String::from_utf16_lossy(std::slice::from_raw_parts(text, n));
            LocalFree(text.cast());
            LocalFree(descriptor);
            sddl
        }
    }
}

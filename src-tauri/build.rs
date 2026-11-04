fn main() {
    // `generate_context!()` embeds the icons at compile time, but Cargo
    // doesn't know that, so a regenerated icon set kept the old Dock icon.
    println!("cargo:rerun-if-changed=icons");
    // `tauri.conf.json` points at `package.json` for the version, and the
    // resolved version is baked in when this script runs. Cargo only knows
    // the config file, so a release's version bump needs this line.
    println!("cargo:rerun-if-changed=../package.json");
    build_ai_helper();
    tauri_build::build()
}

/// Compiles the Apple Intelligence helper (`macos/ai-helper.swift`) to
/// `binaries/ai-helper-<target>`, where Tauri picks it up as a sidecar
/// (`tauri.macos.conf.json`) and copies it next to the app's binary.
/// Needs Xcode's Swift compiler, as the app icons do.
fn build_ai_helper() {
    let target = std::env::var("TARGET").unwrap_or_default();
    if !target.ends_with("apple-darwin") {
        return;
    }
    println!("cargo:rerun-if-changed=macos/ai-helper.swift");
    let arch = if target.starts_with("aarch64") {
        "arm64"
    } else {
        "x86_64"
    };
    let out_dir = std::path::Path::new("binaries");
    std::fs::create_dir_all(out_dir).expect("create src-tauri/binaries");
    let out = out_dir.join(format!("ai-helper-{target}"));
    let status = std::process::Command::new("xcrun")
        .args(["swiftc", "-parse-as-library", "-O", "-target"])
        // Foundation Models arrived in macOS 26; on older systems the helper
        // won't start and the app shows Apple Intelligence as unavailable.
        .arg(format!("{arch}-apple-macos26.0"))
        .arg("macos/ai-helper.swift")
        .arg("-o")
        .arg(&out)
        .status()
        .expect("run xcrun swiftc (install Xcode) to build the Apple Intelligence helper");
    assert!(status.success(), "building macos/ai-helper.swift failed");
}

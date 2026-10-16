fn main() {
    // `generate_context!()` embeds the icons at compile time, but Cargo
    // doesn't know that, so a regenerated icon set kept the old Dock icon.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}

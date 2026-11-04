//! Reads the app's brand from `brand.json` at the top of the repository and
//! hands it to the code as `BRAND_*` variables (see `src/brand.rs`), so the
//! name is written in one place. The version comes the same way, from
//! `package.json` (`APP_VERSION`), which is where releases bump it.

use std::path::Path;

fn main() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../brand.json");
    println!("cargo:rerun-if-changed={}", path.display());
    let text = std::fs::read_to_string(&path).expect("read brand.json");
    let brand: serde_json::Value = serde_json::from_str(&text).expect("parse brand.json");
    for (key, var) in [
        ("name", "BRAND_NAME"),
        ("shortName", "BRAND_SHORT_NAME"),
        ("id", "BRAND_ID"),
        ("envPrefix", "BRAND_ENV_PREFIX"),
    ] {
        let value = brand[key]
            .as_str()
            .unwrap_or_else(|| panic!("brand.json needs \"{key}\""));
        println!("cargo:rustc-env={var}={value}");
    }

    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../package.json");
    println!("cargo:rerun-if-changed={}", path.display());
    let text = std::fs::read_to_string(&path).expect("read package.json");
    let package: serde_json::Value = serde_json::from_str(&text).expect("parse package.json");
    let version = package["version"]
        .as_str()
        .expect("package.json needs \"version\"");
    println!("cargo:rustc-env=APP_VERSION={version}");
}

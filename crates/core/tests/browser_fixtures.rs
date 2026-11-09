//! Writes the sanitizer's real output for the browser tests
//! (`tests/browser/fixtures/`), which fake the Rust side, so they test
//! what the reader is actually given rather than a hand-made copy.

use std::path::Path;

use mail_core::mail::sanitize::sanitize_html;

/// `trackers.json`: `trackers.html` sanitized with remote images loading
/// and held back, for `tests/browser/trackers.spec.ts`. Fails if the file
/// was out of date (it's rewritten here, like `bindings.ts`).
#[test]
fn tracker_fixture_is_up_to_date() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/browser/fixtures");
    let html = std::fs::read_to_string(dir.join("trackers.html")).unwrap();
    let fixture = serde_json::json!({
        "loaded": sanitize_html(&html, true),
        "blocked": sanitize_html(&html, false),
    });
    let after = serde_json::to_string_pretty(&fixture).unwrap() + "\n";
    let path = dir.join("trackers.json");
    let before = std::fs::read_to_string(&path).unwrap_or_default();
    if before != after {
        std::fs::write(&path, &after).unwrap();
    }
    assert!(
        before == after,
        "tests/browser/fixtures/trackers.json was out of date and has been regenerated; commit the new file"
    );
}

/// `image-sizes.json`: `image-sizes.html` (made-up images with only a height,
/// only a width, both, none, and one in a narrow cell) sanitized with remote
/// images loading, for `tests/browser/image-sizes.spec.ts`.
#[test]
fn image_sizes_fixture_is_up_to_date() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/browser/fixtures");
    let html = std::fs::read_to_string(dir.join("image-sizes.html")).unwrap();
    let fixture = serde_json::json!({ "loaded": sanitize_html(&html, true) });
    let after = serde_json::to_string_pretty(&fixture).unwrap() + "\n";
    let path = dir.join("image-sizes.json");
    let before = std::fs::read_to_string(&path).unwrap_or_default();
    if before != after {
        std::fs::write(&path, &after).unwrap();
    }
    assert!(
        before == after,
        "tests/browser/fixtures/image-sizes.json was out of date and has been regenerated; commit the new file"
    );
}

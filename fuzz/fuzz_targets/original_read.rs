#![no_main]
//! An email's raw source (`mail::original`, "Show original"): the sizes and
//! cut-off it states, and that authentication results are shown only when the
//! topmost header is Gmail's own. See `parse_check`.

use libfuzzer_sys::fuzz_target;
use mail_core::parse_check;

fuzz_target!(|data: &[u8]| {
    let problems = parse_check::original_problems(data);
    assert!(
        problems.is_empty(),
        "{problems:#?}\nfrom {:?}",
        String::from_utf8_lossy(data)
    );
});

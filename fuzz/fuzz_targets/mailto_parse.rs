#![no_main]
//! `mailto:` links (`mail::mailto`), which arrive from other apps and from
//! links inside emails: read only when it is one, recipients trimmed and
//! never empty, the body free of carriage returns. See `parse_check`.

use libfuzzer_sys::fuzz_target;
use mail_core::parse_check;

fuzz_target!(|data: &[u8]| {
    let link = String::from_utf8_lossy(data);
    let problems = parse_check::mailto_problems(&link);
    assert!(problems.is_empty(), "{problems:#?}\nfrom {link:?}");
    // Most inputs aren't a link at all: give the reader the scheme too.
    let link = format!("mailto:{link}");
    let problems = parse_check::mailto_problems(&link);
    assert!(problems.is_empty(), "{problems:#?}\nfrom {link:?}");
});

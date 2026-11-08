#![no_main]
//! The file names an email picks (attachments, images, the subject of a
//! downloaded original), cleaned by `attachments::safe_filename`: one path
//! component, nothing macOS or Windows rejects or treats as a device, no
//! text-direction controls, short enough in bytes, stable when cleaned
//! again. See `parse_check`.

use libfuzzer_sys::fuzz_target;
use mail_core::parse_check;

fuzz_target!(|data: &[u8]| {
    let name = String::from_utf8_lossy(data);
    let problems = parse_check::filename_problems(&name);
    assert!(problems.is_empty(), "{problems:#?}\nfrom {name:?}");
});

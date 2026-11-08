# Fuzzing

Coverage-guided fuzzing of the code that reads untrusted email, with
[cargo-fuzz](https://github.com/rust-fuzz/cargo-fuzz) (libFuzzer). Each
target feeds random input to one piece of `crates/core` and fails when what
comes out is unsafe. A failure is a security bug: report it as one (see
`SECURITY.md`), don't post the input publicly.

| Target | Dictionary, longest input | What it checks |
|---|---|---|
| `sanitize_html` | `html.dict`, 4096 | The email HTML cleaner (`mail::sanitize`) and the plain-text path. Whatever goes in, the document that comes out must pass `mail::sanitize_check`: the app's CSP first, no script or frame, no event handler, no link or image with an unsafe scheme, and no remote image while images are held back. |
| `mailto_parse` | `mailto.dict`, 2048 | `mailto:` links (`mail::mailto`), from other apps and from links in emails: read only when it is one, recipients trimmed and never empty, no carriage return in the body. |
| `original_read` | `mailto.dict`, 8192 | An email's raw source (`mail::original`, "Show original"): the sizes and cut-off it states, and, for a well-formed header block, verdicts shown only when the topmost `Authentication-Results` names Gmail. |
| `gmail_message` | `gmail.dict`, 8192 | A Gmail message (`gmail::parse`): addresses, bodies, charsets, the calendar part and attachment names, read without a panic. The first byte picks raw JSON text or a tree of parts built from the rest. |
| `file_name` | `gmail.dict`, 512 | The file names an email picks (`attachments::safe_filename`, and the name of a downloaded original): one path component, nothing macOS or Windows rejects or treats as a device, no text-direction characters, short enough in bytes, the same when cleaned again. |

The same checks also run as property tests in every `cargo test`
(`crates/core/src/mail/sanitize_check.rs` for the cleaner,
`crates/core/src/parse_check.rs` for the rest), so a pull request is tested
on stable Rust without fuzzing. Fuzzing goes deeper: it learns which inputs
reach new code and keeps them.

## Running it

cargo-fuzz needs the nightly toolchain. One-time setup:

```
rustup toolchain install nightly --profile minimal
cargo install cargo-fuzz --locked
```

From the repository's root, run a target for ten minutes (the dictionary and
the longest input are in the table above):

```
cargo +nightly fuzz run sanitize_html fuzz/corpus/sanitize_html fuzz/seeds/sanitize_html -- \
  -dict=fuzz/html.dict -max_total_time=600 -max_len=4096 -timeout=10
```

The first build takes a few minutes. `fuzz/corpus/` holds the inputs it has
learned from, kept between runs (not committed). `fuzz/seeds/` holds a few
made-up inputs to start from, and the `.dict` files the tokens each reader
has to get right: tags, schemes and CSS for the cleaner, link fields and
header names for `mailto:` links and raw emails, JSON keys, MIME types and
tricky file names for messages and file names.
The seeds are kept byte for byte (`.gitattributes` leaves them alone): a raw
email's CRLF line breaks are part of the input.

A weekly job runs each target for ten minutes too (`.github/workflows/fuzz.yml`,
or by hand from the Actions tab, one job per target), and keeps the failing
input as an artifact. The build is its own step, so the ten minutes are
fuzzing alone.

## When it fails

libFuzzer stops, prints what the checker found, and saves the input under
`fuzz/artifacts/sanitize_html/`. To see it again:

```
cargo +nightly fuzz run sanitize_html fuzz/artifacts/sanitize_html/crash-…
```

`cargo +nightly fuzz tmin sanitize_html <file>` shrinks it to the smallest
input that still fails. Before fixing the cleaner, check whether the checker
is right: it reads the document the way a browser does (the URL Standard for
addresses, `cssparser` for CSS), and a false alarm is fixed there instead.
Either way, add the shrunk input as a test, with made-up text only.

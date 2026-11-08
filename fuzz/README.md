# Fuzzing

Coverage-guided fuzzing of the code that reads untrusted email, with
[cargo-fuzz](https://github.com/rust-fuzz/cargo-fuzz) (libFuzzer). Each
target feeds random input to one piece of `crates/core` and fails when what
comes out is unsafe. A failure is a security bug: report it as one (see
`SECURITY.md`), don't post the input publicly.

| Target | What it checks |
|---|---|
| `sanitize_html` | The email HTML cleaner (`mail::sanitize`) and the plain-text path. Whatever goes in, the document that comes out must pass `mail::sanitize_check`: the app's CSP first, no script or frame, no event handler, no link or image with an unsafe scheme, and no remote image while images are held back. |

The same checks also run as property tests in every `cargo test`
(`crates/core/src/mail/sanitize_check.rs`), so a pull request is tested on
stable Rust without fuzzing. Fuzzing goes deeper: it learns which inputs
reach new code and keeps them.

## Running it

cargo-fuzz needs the nightly toolchain. One-time setup:

```
rustup toolchain install nightly --profile minimal
cargo install cargo-fuzz --locked
```

From the repository's root, run a target for ten minutes:

```
cargo +nightly fuzz run sanitize_html fuzz/corpus/sanitize_html fuzz/seeds/sanitize_html -- \
  -dict=fuzz/html.dict -max_total_time=600 -max_len=4096
```

The first build takes a few minutes. `fuzz/corpus/` holds the inputs it has
learned from, kept between runs (not committed). `fuzz/seeds/` holds a few
made-up emails to start from, and `fuzz/html.dict` the tags, schemes and CSS
tokens the cleaner has to get right.

A weekly job runs each target for ten minutes too (`.github/workflows/fuzz.yml`,
or by hand from the Actions tab), and keeps the failing input as an artifact.

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

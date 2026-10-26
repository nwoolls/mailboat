#!/usr/bin/env bash
# Builds or checks the app for Windows from this Mac (cross-compiling).
#
#   scripts/windows.sh check   clippy for Windows: does it compile, no warnings
#   scripts/windows.sh build   the installer, <product name>_<version>_arm64-setup.exe
#
# The target defaults to Windows on ARM (a VM on Apple silicon); set
# WINDOWS_TARGET=x86_64-pc-windows-msvc for Intel/AMD PCs.
#
# One-time setup:
#   rustup target add aarch64-pc-windows-msvc x86_64-pc-windows-msvc
#   brew install llvm lld nsis
#   cargo install cargo-xwin --locked
# cargo-xwin downloads Microsoft's Windows SDK libraries on first use
# (accepting their licence) into ~/Library/Caches/cargo-xwin.
#
# Only the NSIS installer (.exe) can be made on a Mac; the .msi needs WiX,
# which runs on Windows only.
set -euo pipefail

target="${WINDOWS_TARGET:-aarch64-pc-windows-msvc}"
# Homebrew keeps LLVM and LLD off PATH so they don't shadow Xcode's clang.
export PATH="/opt/homebrew/opt/llvm/bin:/opt/homebrew/opt/lld/bin:$PATH"

for tool in cargo-xwin makensis clang-cl lld-link; do
  if ! command -v "$tool" >/dev/null; then
    echo "Missing $tool: see the one-time setup at the top of $0." >&2
    exit 1
  fi
done

cd "$(dirname "$0")/.."
case "${1:-}" in
  check)
    cargo xwin clippy --workspace --all-targets --target "$target" -- -D warnings
    ;;
  build)
    bun tauri build --runner cargo-xwin --target "$target" --bundles nsis
    echo
    echo "Installer:"
    ls -1 "target/$target/release/bundle/nsis/"*.exe
    ;;
  *)
    echo "usage: $0 check|build" >&2
    exit 2
    ;;
esac

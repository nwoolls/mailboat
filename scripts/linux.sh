#!/usr/bin/env bash
# Checks, tests or packages the app for Linux from this Mac, in a Docker
# container (Tauri's Linux build needs GTK and WebKitGTK, so it can't be
# cross-compiled from macOS as Windows is).
#
#   scripts/linux.sh check   clippy and the Rust tests, on Linux
#   scripts/linux.sh build   the .deb, .rpm and AppImage, into target/linux/
#   scripts/linux.sh shell   a shell in the container, in a copy of the repository
#
# The container matches the Mac's processor (Arm on Apple silicon), so the
# packages are for Arm Linux; CI's test builds make the Intel/AMD ones.
#
# One-time setup: Docker Desktop (or another Docker), running. The first run
# builds the image (a few minutes); Rust's build and Bun's packages are kept
# in Docker volumes between runs. `docker volume rm` the `<short name>-linux-*`
# volumes (`docker volume ls`) to start over. Rust builds 4 crates at a time
# (LINUX_JOBS to change it): with Docker's default memory, linking the test
# programs all at once ran out of memory.
set -euo pipefail

cd "$(dirname "$0")/.."
if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't running: start Docker Desktop first." >&2
  exit 1
fi

bun_version="$(sed -n 's/.*"packageManager": "bun@\([^"]*\)".*/\1/p' package.json)"
# Named after the app's short name in brand.json.
name="$(sed -n 's/.*"shortName": "\([^"]*\)".*/\1/p' brand.json)-linux"
image="$name:bun-$bun_version"
if ! docker image inspect "$image" >/dev/null 2>&1; then
  docker build --build-arg "BUN_VERSION=$bun_version" -t "$image" scripts/linux
fi

# The repository is copied into the container's own folder (without the Mac's
# node_modules and target, which hold Mac programs), so nothing the Linux build
# makes lands in the working tree except the packages, in target/linux.
mkdir -p target/linux
sync='rsync -a --delete --exclude /node_modules --exclude /target --exclude /.git /src/ /work/ && bun install --frozen-lockfile'
run() {
  local tty=()
  [ -t 0 ] && tty=(-it)
  docker run --rm ${tty[@]+"${tty[@]}"} \
    -v "$PWD:/src:ro" \
    -v "$PWD/target/linux:/out" \
    -v "$name-work:/work" \
    -v "$name-target:/target" \
    -v "$name-cargo:/root/.cargo/registry" \
    -e CARGO_TARGET_DIR=/target \
    -e "CARGO_BUILD_JOBS=${LINUX_JOBS:-4}" \
    "$image" bash -c "$sync && $1"
}

case "${1:-}" in
  check)
    run 'cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace --no-fail-fast'
    ;;
  build)
    run 'bun tauri build --ci && rm -rf /out/bundle && mkdir -p /out/bundle && cp /target/release/bundle/deb/*.deb /target/release/bundle/rpm/*.rpm /target/release/bundle/appimage/*.AppImage /out/bundle/'
    echo
    echo "Packages:"
    ls -1 target/linux/bundle/
    ;;
  shell)
    run 'exec bash'
    ;;
  *)
    echo "usage: $0 check|build|shell" >&2
    exit 2
    ;;
esac

# The Linux build environment for scripts/linux.sh: the oldest Ubuntu Tauri
# supports (as CI and the test builds use), with what Tauri needs on Linux
# (WebKitGTK, GTK), D-Bus for the keychain, rpm for the .rpm, the time zone
# database (a desktop has it; the tests need it), bubblewrap (Codex's fence;
# Docker only lets it work with --privileged, so its test skips here),
# dbus-daemon (the notifications' test), squashfs-tools (the AppImage's
# bill of materials), and the same
# Bun as package.json. Rust comes from rustup, as on the Mac.
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates curl file git pkg-config rsync tzdata unzip \
      libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libdbus-1-dev rpm bubblewrap dbus squashfs-tools \
    && rm -rf /var/lib/apt/lists/*
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --component clippy,rustfmt
ARG BUN_VERSION
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
ENV PATH=/root/.cargo/bin:/root/.bun/bin:$PATH
WORKDIR /work

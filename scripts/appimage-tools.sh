#!/usr/bin/env bash
# Puts the tools Tauri's AppImage bundler runs where it looks for them, each
# checked against a digest recorded here, so the bundler finds them and never
# downloads its own (it checks no digest, and takes the AppImage plugin from a
# release tag that moves). Also the AppImage runtime (the program at the front
# of every AppImage), which appimagetool would otherwise download unchecked;
# the build is pointed at it with LDAI_RUNTIME_FILE. Run before `tauri build`
# on Linux:
#
#   scripts/appimage-tools.sh        (for this computer's processor)
#   LDAI_RUNTIME_FILE="${XDG_CACHE_HOME:-$HOME/.cache}/tauri/appimage-runtime" bun tauri build
#
# The file names and the linuxdeploy build are the ones Tauri CLI 2.12.5 asks
# for (crates/tauri-bundler/src/bundle/linux/appimage/linuxdeploy.rs). A newer
# CLI may ask for others, which it would then download unchecked, so this stops
# until the names and digests here are brought up to date.
set -euo pipefail

cd "$(dirname "$0")/.."
cli="$(sed -n 's/.*"@tauri-apps\/cli": \["@tauri-apps\/cli@\([^"]*\)".*/\1/p' bun.lock)"
if [ "$cli" != "2.12.5" ]; then
  echo "Tauri CLI is $cli: update the AppImage tools in $0 for it first." >&2
  exit 1
fi

arch="$(uname -m)"
case "$arch" in
  x86_64)
    apprun=f30140a43a0a59e46db21bdefdf749b9e9f2c6946e92afabbacf98b8ae73fb4f
    linuxdeploy=36a2d7e274d12e1050d0e9ecfe11d339ed54720b2bec464c286d53f8b07f5c62
    plugin=992d502a248e14ab185448ddf6f6e7d25558cb84d4623c354c3af350c25fccb3
    runtime=2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d
    ;;
  aarch64)
    apprun=072f17c0895a85c490282fe5395c5007e5fc75da727e553b3b8fb680feb11578
    linuxdeploy=556ab80baa98e600aa80f0dcedfb70bca0e1ce7e9f147fb345be3fcc3e91b2b1
    plugin=83c292149274965a865dcd44c135cfca8ba28c6b7de3eb628d4b8b5f248af17c
    runtime=00cbdfcf917cc6c0ff6d3347d59e0ca1f7f45a6df1a428a0d6d8a78664d87444
    ;;
  *)
    echo "No AppImage tools recorded for $arch" >&2
    exit 1
    ;;
esac

tools="${XDG_CACHE_HOME:-$HOME/.cache}/tauri"
mkdir -p "$tools"
fetch() {
  local url="$1" name="$2" sha="$3"
  local partial="$tools/$name.partial"
  curl --proto '=https' --tlsv1.2 -fsSL -o "$partial" "$url"
  echo "$sha  $partial" | sha256sum -c --quiet
  chmod +x "$partial"
  mv "$partial" "$tools/$name"
}
fetch "https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/AppRun-$arch" \
  "AppRun-$arch" "$apprun"
fetch "https://github.com/tauri-apps/binary-releases/releases/download/linuxdeploy-07333c6/linuxdeploy-$arch.AppImage" \
  "linuxdeploy-07333c6-$arch.AppImage" "$linuxdeploy"
fetch "https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/1-alpha-20250213-1/linuxdeploy-plugin-appimage-$arch.AppImage" \
  "linuxdeploy-plugin-appimage.AppImage" "$plugin"
# The runtime: type2-runtime's dated release, not its moving `continuous`.
fetch "https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-$arch" \
  "appimage-runtime" "$runtime"
echo "AppImage tools and runtime checked and in place in $tools"

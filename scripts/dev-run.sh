#!/bin/sh
# Cargo runner (see .cargo/config.toml) for macOS dev builds. Test binaries
# run untouched; the app binary (`mailboat`) is launched from a real .app:
#
# 1. Dock icon. `tauri dev` runs a bare binary, and macOS only draws an
#    app's icon properly (the Liquid Glass rim and depth, from
#    src-tauri/macos/Assets.car) for a bundle. So the binary is copied into
#    target/<profile>/Mailboat.app with an Info.plist and the icons, as
#    MonoCode does. (The app also clears the flat picture Tauri sets on the
#    Dock in dev; see src-tauri/src/dock.rs.)
#
# 2. Keychain. macOS remembers keychain access per exact build. Unsigned dev
#    builds change on every rebuild, so the "allow keychain access" prompt
#    came back after every Rust change. Signing with your Apple Development
#    certificate gives every build the same identity, so "Always Allow"
#    sticks. Override the certificate with MAILBOAT_DEV_SIGNING_IDENTITY if you
#    have several.
#
# 3. mailto: links. The Info.plist claims the mailto scheme, and the bundle
#    is registered with Launch Services, so Settings → General can make
#    this dev build the default email reader.
set -e
bin="$1"
shift

if [ "$(basename "$bin")" != "mailboat" ]; then
  exec "$bin" "$@"
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$root/src-tauri/tauri.conf.json" | head -n 1)"
app="$(dirname "$bin")/Mailboat.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin" "$app/Contents/MacOS/mailboat"
cp "$root/src-tauri/icons/icon.icns" "$app/Contents/Resources/AppIcon.icns"
cp "$root/src-tauri/macos/Assets.car" "$app/Contents/Resources/Assets.car"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleDisplayName</key>
	<string>Mailboat</string>
	<key>CFBundleExecutable</key>
	<string>mailboat</string>
	<key>CFBundleIconFile</key>
	<string>AppIcon</string>
	<key>CFBundleIconName</key>
	<string>AppIcon</string>
	<key>CFBundleIdentifier</key>
	<string>com.nwoolls.mailboat</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>Mailboat</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>$version</string>
	<key>CFBundleVersion</key>
	<string>$version</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleURLName</key>
			<string>Email Address URL</string>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>mailto</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
PLIST
# Tells the Dock and Finder the icon may have changed.
touch "$app"

identity="${MAILBOAT_DEV_SIGNING_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null \
  | sed -n 's/.*"\(Apple Development: [^"]*\)".*/\1/p' | head -n 1)}"
if [ -n "$identity" ]; then
  codesign --force --sign "$identity" --identifier com.nwoolls.mailboat "$app" 2>/dev/null \
    || echo "dev-run: signing with \"$identity\" failed; continuing unsigned" >&2
else
  echo "dev-run: no Apple Development certificate found; macOS will ask for keychain access after each rebuild (see CLAUDE.md)" >&2
fi

lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[ -x "$lsregister" ] && "$lsregister" -f "$app" >/dev/null 2>&1 || true

exec "$app/Contents/MacOS/mailboat" "$@"

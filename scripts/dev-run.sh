#!/bin/sh
# Cargo runner (see .cargo/config.toml) for macOS dev builds. Test binaries
# run untouched; the app binary (the `desktop` package) is launched from a
# real .app named after brand.json:
#
# 1. Dock icon. `tauri dev` runs a bare binary, and macOS only draws an
#    app's icon properly (the Liquid Glass rim and depth, from
#    src-tauri/macos/Assets.car) for a bundle. So the binary is copied into
#    target/<profile>/<name>.app with an Info.plist and the icons, as
#    MonoCode does. (The app also clears the flat picture Tauri sets on the
#    Dock in dev; see src-tauri/src/dock.rs.)
#
# 2. Keychain. macOS remembers keychain access per exact build. Unsigned dev
#    builds change on every rebuild, so the "allow keychain access" prompt
#    came back after every Rust change. Signing with your Apple Development
#    certificate gives every build the same identity, so "Always Allow"
#    sticks. Override the certificate with DEV_SIGNING_IDENTITY if you
#    have several.
#
# 3. mailto: links. The Info.plist claims the mailto scheme, and the bundle
#    is registered with Launch Services, so Settings → General can make
#    this dev build the default email reader.
set -e
bin="$1"
shift

root="$(cd "$(dirname "$0")/.." && pwd)"
brand() { sed -n "s/^ *\"$1\": *\"\([^\"]*\)\".*/\1/p" "$root/brand.json" | head -n 1; }
name="$(brand name)"
short="$(brand shortName)"
id="$(brand id)"

case "$(basename "$bin")" in
  desktop | "$short") ;;
  *) exec "$bin" "$@" ;;
esac

version="$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$root/src-tauri/tauri.conf.json" | head -n 1)"
app="$(dirname "$bin")/$name.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin" "$app/Contents/MacOS/$short"
# The Apple Intelligence helper, which Tauri copies next to the binary.
[ -f "$(dirname "$bin")/ai-helper" ] && cp "$(dirname "$bin")/ai-helper" "$app/Contents/MacOS/ai-helper" || true
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
	<string>$name</string>
	<key>CFBundleExecutable</key>
	<string>$short</string>
	<key>CFBundleIconFile</key>
	<string>AppIcon</string>
	<key>CFBundleIconName</key>
	<string>AppIcon</string>
	<key>CFBundleIdentifier</key>
	<string>$id</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$name</string>
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

identity="${DEV_SIGNING_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null \
  | sed -n 's/.*"\(Apple Development: [^"]*\)".*/\1/p' | head -n 1)}"
if [ -n "$identity" ]; then
  # Nested code is signed first, or signing the app fails.
  [ -f "$app/Contents/MacOS/ai-helper" ] && codesign --force --sign "$identity" \
    --identifier "$id.ai" "$app/Contents/MacOS/ai-helper" 2>/dev/null || true
  codesign --force --sign "$identity" --identifier "$id" "$app" 2>/dev/null \
    || echo "dev-run: signing with \"$identity\" failed; continuing unsigned" >&2
else
  echo "dev-run: no Apple Development certificate found; macOS will ask for keychain access after each rebuild (see CLAUDE.md)" >&2
fi

lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[ -x "$lsregister" ] && "$lsregister" -f "$app" >/dev/null 2>&1 || true

exec "$app/Contents/MacOS/$short" "$@"

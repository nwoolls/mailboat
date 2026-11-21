#!/bin/bash
# Puts the running demo window where shoot.sh looks: 1424x820 at 640,300 on
# the main display. usage: place.sh   (the demo is already running)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
OUT="${OUT:-/tmp/shots}"
name="$(cd "$repo" && bun -p "require('./brand.json').name")"
# Only the demo, started with --demo: an installed copy of the app may be
# running too, and its window shows real mail.
pid=""
for candidate in $(ps -axo pid,args | grep -F -- "--demo" | grep -v grep | awk '{print $1}'); do
  if "$OUT/bin/windows" "$name" | awk -v p="$candidate" '$1==p && ($5=="true" || $5=="1"){found=1} END{exit !found}'; then
    pid="$candidate"; break
  fi
done
[ -n "$pid" ] || { echo "no on-screen window of the demo: start it first (bun run demo)"; exit 1; }
echo "$pid" > "$OUT/demo-pid"
# A window wider than the room right of x=640 keeps part of its old width on
# the first try, so try until it is where it should be.
for try in 1 2 3; do
  osascript <<APPLESCRIPT
tell application "System Events"
  set frontmost of (first process whose unix id is $pid) to true
  tell window 1 of (first process whose unix id is $pid)
    set position to {640, 300}
    set size to {1424, 820}
  end tell
end tell
APPLESCRIPT
  sleep 0.5
  "$OUT/bin/windows" "$name" | awk -v p="$pid" '$1==p && ($5=="1"||$5=="true") && $6=="1424x820@640,300"{ok=1} END{exit !ok}' && exit 0
done
echo "the demo window would not go to 1424x820 at 640,300"; exit 1

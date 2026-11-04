#!/bin/bash
# One screenshot: a picture behind the window (so its translucent parts
# show it), the pointer out of the way, then the region around the window.
# 16:9 (1600x900): the 1424x820 window from place.sh with its margin.
# usage: shoot.sh <wallpaper.png> <out.png>
# The demo must be running and placed (place.sh), in the state to shoot.
set -euo pipefail
OUT="${OUT:-/tmp/shots}"
pid="$(cat "$OUT/demo-pid")"
# The picture: 1660x960 at 522,230, around the 1600x900 shot (1424x820 window).
backdrop_left=522; backdrop_top=230; backdrop_width=1660; backdrop_height=960
[ -f "$1" ] || { echo "no wallpaper at $1: not capturing"; exit 1; }
"$OUT/bin/backdrop" "$backdrop_left" "$backdrop_top" "$backdrop_width" "$backdrop_height" "$1" &
backdrop=$!
# The picture always goes away, whatever happens below.
trap 'kill "$backdrop" 2>/dev/null || true' EXIT
sleep 1.2
osascript -e "tell application \"System Events\" to set frontmost of (first process whose unix id is $pid) to true" >/dev/null 2>&1
"$OUT/bin/mouse" 2500 60
sleep 1.2
screencapture -R 552,260,1600,900 -x "$2"
kill "$backdrop" 2>/dev/null || true
wait "$backdrop" 2>/dev/null || true

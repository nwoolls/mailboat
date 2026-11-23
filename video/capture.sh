#!/bin/bash
# Takes the trailer's pictures and loops of the demo at 2x, on a Retina
# screen, into video/public/rec/ (ignored by git: they are made again here).
# Every take is of demo mode's made-up mail, on a demo started fresh for it,
# and nothing is tried out before it is taken: a reply opened and closed
# leaves a draft that changes what later takes show.
#
# Needs: the demo running and alone (bun run demo, with the app's
# <prefix>_DEMO_UPDATE_AFTER=off), the helpers from
# scripts/screenshots/build.sh in $OUT/bin and its wallpapers in $OUT/bg,
# and a Retina screen whose top-left corner (in points, as screencapture
# counts them) is SCREEN_X,SCREEN_Y. The window goes 88,80 points into it,
# at the gallery's size (1424x820), so a take lines up with the gallery's
# 1600x900 pictures at twice their size (3200x1800).
#
# usage: OUT=… SCREEN_X=2560 SCREEN_Y=342 video/capture.sh <take> [<take> …]
#   takes, in the order a fresh demo needs them (the sign-in code alert
#   arrives about 45 s in; `codes` keeps it, everything after dismisses it):
#   setup open-codes codes palette dark inbox conversation (reply-ai on a demo of its own)
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:?set OUT to the folder of scripts/screenshots/build.sh}"
SX="${SCREEN_X:?}"; SY="${SCREEN_Y:?}"
REC="$here/public/rec"
mkdir -p "$REC"
name="$(cd "$here/.." && bun -p "require('./brand.json').name")"
pid=""
for p in $(ps -axo pid,args | grep -F -- "--demo" | grep -v grep | awk '{print $1}'); do
  "$OUT/bin/windows" "$name" | awk -v p="$p" '$1==p && ($5=="1"||$5=="true"){f=1} END{exit !f}' && { pid="$p"; break; }
done
[ -n "$pid" ] || { echo "no on-screen window of the demo (bun run demo)"; exit 1; }

# What runs in the background while a take is made: the wallpaper behind the
# window, the recording, and the file it writes. However the script ends (a
# step failing, Ctrl-C, a kill), they are stopped and a recording cut short
# is deleted; Ctrl-C and a kill end the script there, not at the next step.
bd=""
rec=""
partial=""
cleanup() {
  [ -n "$rec" ] && kill "$rec" 2>/dev/null
  [ -n "$bd" ] && kill "$bd" 2>/dev/null
  [ -n "$partial" ] && rm -f "$partial"
  rec=""; bd=""; partial=""
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Every click, key and capture below is at a screen position or goes to the
# frontmost app, so each is sent only while the demo is frontmost and its
# window is where `setup` put it; anything else stops the script.
stop() { echo "$1: stopping"; exit 1; }
ev() { osascript -e "tell application \"System Events\" to $1" >/dev/null 2>&1 || stop "System Events refused: $1"; }
placed() {
  "$OUT/bin/windows" "$name" | awk -v p="$pid" -v want="1424x820@$((SX + 88)),$((SY + 80))" '$1==p && $6==want{ok=1} END{exit !ok}'
}
guard() {
  local front
  front="$(osascript -e 'tell application "System Events" to unix id of first process whose frontmost is true' 2>/dev/null)"
  [ "$front" = "$pid" ] || stop "the demo is not the frontmost app"
  placed || stop "the demo window is not where setup put it (run setup)"
}
focus() { ev "set frontmost of (first process whose unix id is $pid) to true"; sleep 0.5; guard; }
# A wait during a take (whole seconds), checking all along that the demo is
# still frontmost and in place, so a recording never runs on over another app.
hold() { local end=$((SECONDS + $1)); while [ "$SECONDS" -lt "$end" ]; do guard; sleep 0.25; done; }
# A point of a gallery picture (1600x900, the window at 88,40 in it), on screen.
c() { guard; "$OUT/bin/click" $((SX + $1)) $((SY + 40 + $2)) || stop "click failed"; sleep "${3:-1.2}"; }
key() { guard; ev "keystroke \"$1\"${2:+ using $2 down}"; sleep "${3:-1}"; }
esc() { guard; ev "key code 53"; sleep 0.7; }
region="$SX,$((SY + 40)),1512,900"
# The 3024x1800 take, padded on the right to the gallery's frame at 2x.
pad() { ffmpeg -v error -y -i "$1" "${@:3}" -vf "pad=3200:1800:0:0:color=black" "$2"; }

place() {
  local try
  for try in 1 2 3; do
  osascript <<EOF
tell application "System Events"
  set frontmost of (first process whose unix id is $pid) to true
  tell window 1 of (first process whose unix id is $pid)
    set position to {$((SX + 88)), $((SY + 80))}
    set size to {1424, 820}
  end tell
end tell
EOF
  sleep 0.6
  # The first try can land short of its place (as place.sh found): try again.
  placed && return 0
  done
  echo "the window would not go to its place"; "$OUT/bin/windows" "$name"; exit 1
}
# Settings: open, a sidebar row, a point on the page, back (gallery positions).
settings() { focus; key "," command 1.6; c 145 "$1" 1.6; c "$2" "$3" 1.6; c 143 842 1.4; }
backdrop() { "$OUT/bin/backdrop" "$SX" $((SY + 40)) 1512 900 "$OUT/bg/$1.png" & bd=$!; sleep 1.2; focus; "$OUT/bin/mouse" $((SX + 750)) $((SY + 12)); sleep 0.4; }
still() {   # still <name> <wallpaper>
  backdrop "$2"
  guard
  screencapture -x -R "$region" "$REC/$1.raw.png" && [ -s "$REC/$1.raw.png" ] || stop "no picture of $1 (screen recording allowed?)"
  kill "$bd" 2>/dev/null; bd=""
  pad "$REC/$1.raw.png" "$REC/$1.png" || stop "padding $1 failed"
  rm -f "$REC/$1.raw.png"; echo "took $1"
}
record() {  # record <name> <wallpaper> <seconds> <steps…>
  local clip="$1" paper="$2" most="$3"; shift 3
  backdrop "$paper"
  guard
  rm -f "$REC/$clip.mov"
  partial="$REC/$clip.mov"
  screencapture -v -V "$most" -R "$region" -x "$REC/$clip.mov" & rec=$!
  hold 1
  "$@"
  # The steps must finish inside the recording's limit; then the rest of the
  # recording is watched too, until it ends.
  kill -0 "$rec" 2>/dev/null || stop "the recording of $clip ended before its steps did: raise its limit"
  while kill -0 "$rec" 2>/dev/null; do guard; sleep 0.25; done
  wait "$rec" && [ -s "$REC/$clip.mov" ] || stop "no recording of $clip (screen recording allowed?)"
  rec=""; partial=""
  kill "$bd" 2>/dev/null; bd=""
  pad "$REC/$clip.mov" "$REC/$clip.mp4" -an -r 60 -c:v libx264 -preset slow -crf 14 -g 30 -pix_fmt yuv420p -movflags +faststart \
    || stop "converting $clip failed"
  rm -f "$REC/$clip.mov"; echo "recorded $clip"
}

palette_steps() {
  sleep 0.8; key k command 1.4
  local ch; for ch in a r c h; do guard; ev "keystroke \"$ch\""; sleep 0.15; done
  hold 3
}
reply_ai_steps() {
  c 798 766 2.2                       # Reply
  c 1393 825 1.6                      # the AI button in the reply's bar
  guard; ev 'keystroke "Confirm the booking"'; sleep 0.6
  guard; ev 'key code 36'; hold 14    # Return: ask for the draft
}

for take in "$@"; do
  case "$take" in
    setup)          # place it, keep mail unread when opened, light
      place; settings 284 1140 380; settings 228 1101 290 ;;
    open-codes)     # the sign-in code open, its alert still up (light): check it, then `codes`
      focus; c 144 134 1.4; c 600 156 1.0; c 600 156 2.2 ;;
    codes) still codes-light sonoma ;;
    palette)        # ⌘K over Lisbon, typing (light); dismisses the alert
      focus; esc; esc; c 1481 104 0.8; c 144 134 1.4; c 600 300 2.4
      record palette-light sonoma 12 palette_steps; esc ;;
    dark) settings 228 1165 290 ;;
    inbox) focus; esc; esc; c 144 134 1.6; still inbox-dark sunset ;;
    conversation) focus; c 600 300 2.4; still conversation-dark sunset ;;
    reply-ai)       # Reply, then the AI button (dark, a fresh demo: it leaves a draft)
      focus; esc; esc; c 1481 104 0.8; c 144 134 1.4; c 600 300 2.5
      record reply-ai sunset 26 reply_ai_steps ;;
    *) echo "unknown take: $take"; exit 1 ;;
  esac
done

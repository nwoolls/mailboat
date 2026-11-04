#!/bin/bash
# The feature gallery, one function per picture. Needs the demo running
# and placed (place.sh). usage: gallery.sh <dark|light> [feature ...]
# Pictures land in $OUT/gallery/<theme>/<feature>.png (1600x900, 16:9).
#
# Positions: the window is at 640,300 (1424x820); a window capture has 56px
# of shadow at the sides and 28px above, so a point seen at (cx,cy) in such
# a capture is at (584+cx, 272+cy) on screen.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-/tmp/shots}"
theme="${1:?dark or light}"; shift || true
# Put the demo window in its place first (the app can move it), then read its pid.
OUT="$OUT" "$here/place.sh" || exit 1
sleep 1.5
pid="$(cat "$OUT/demo-pid")"
case "$theme" in
  dark) wallpaper="$OUT/bg/sunset.png"; theme_x=1133; scheme="1073 680" ;;   # Dark in Settings -> Appearance; Ocean
  light) wallpaper="$OUT/bg/sonoma.png"; theme_x=1069; scheme="880 752" ;;  # Light; Dusk (koi read better on light)
  *) echo "dark or light"; exit 1 ;;
esac
mkdir -p "$OUT/gallery/$theme"

ev() { osascript -e "tell application \"System Events\" to $1" >/dev/null 2>&1; }
name="$(cd "$here/../.." && bun -p "require('./brand.json').name")"
# Every click and key below is at a screen position: only go on if the demo window is where place.sh put it.
check_window() {
  "$OUT/bin/windows" "$name" | awk -v p="$pid" '$1==p && ($5=="1"||$5=="true") && $6=="1424x820@640,300"{ok=1} END{exit !ok}' \
    || { echo "the demo window is not at its place (run place.sh): not clicking anything; it is at:"; "$OUT/bin/windows" "$name" | awk -v p="$pid" '$1==p'; exit 1; }
}
focus() { check_window; ev "set frontmost of (first process whose unix id is $pid) to true"; sleep 0.6; }
key() { ev "keystroke \"$1\"${2:+ using $2 down}"; sleep "${3:-1}"; }
esc() { ev "key code 53"; sleep 0.8; }
click() { ev "click at {$((584 + $1)), $((272 + $2))}"; sleep "${3:-1.5}"; }   # capture coordinates
shoot() { "$here/shoot.sh" "$wallpaper" "$OUT/gallery/$theme/$1.png"; echo "shot $theme/$1"; }

# Settings sidebar rows (capture y); the sidebar is at x=113.
settings_y() {
  case "$1" in
    general) echo 132 ;; accounts) echo 160 ;; notifications) echo 188 ;; appearance) echo 216 ;;
    list) echo 244 ;; viewing) echo 272 ;; composing) echo 300 ;; ai) echo 328 ;;
    signatures) echo 356 ;; rules) echo 384 ;; vacation) echo 412 ;; keyboard) echo 440 ;;
    toybox) echo 468 ;; advanced) echo 496 ;;
  esac
}
dismiss_toast() { [ -n "${KEEP_TOAST:-}" ] || { ev "click at {2033, 364}"; sleep 0.8; }; }   # the demo's sign-in code alert, top right (KEEP_TOAST=1 leaves it)
settings() { focus; esc; key "," command 1.6; dismiss_toast; click 113 "$(settings_y "$1")" 1.8; }
leave_settings() { click 111 830 1.5; }   # the Back button

set_theme() { settings appearance; click "$theme_x" 278 2.5; leave_settings; }
# Opening conversations must not change the unread counts shown in the sidebar.
keep_unread() { settings viewing; click 1108 368 1; leave_settings; }

# ---- features -------------------------------------------------------------
feature_rules() {   # the rule editor, over the list of rules
  settings rules; click 994 306 1.8; shoot rules; esc; leave_settings
}

scrolldown() { "$OUT/bin/scroll" 1100 700 "-$1"; sleep 1; }

feature_vacation() { settings vacation; shoot vacation; leave_settings; }
feature_signatures() { settings signatures; shoot signatures; leave_settings; }
feature_ai() { settings ai; shoot ai; leave_settings; }
feature_ai_apps() { settings ai; scrolldown 700; shoot ai-apps; leave_settings; }   # keep the command path (it has a local path) below the fold
feature_toybox() { settings toybox; click 950 572 1; shoot toybox; leave_settings; }   # Bubble wrap chosen
feature_appearance() { settings appearance; shoot appearance; leave_settings; }
feature_keyboard() { settings keyboard; shoot keyboard; leave_settings; }
feature_list() { settings list; shoot list; leave_settings; }   # rows, preview lines and swipes

# Main window: a point seen in a shot (1600x900) is at (552+x, 260+y) on screen.
sclick() { ev "click at {$((552 + $1)), $((260 + $2))}"; sleep "${3:-1.5}"; }
main_view() { focus; esc; esc; dismiss_toast; sclick 144 134 1.4; }   # always from the unified Inbox
feature_inbox() { main_view; shoot inbox; }

feature_conversation() { main_view; sclick 600 300 2.2; shoot conversation; }   # Lisbon: the AI summary above the messages
feature_invitation() { main_view; sclick 600 516 2.2; shoot invitation; }         # a meeting invitation, answered in the email
feature_codes() { main_view; sclick 600 156 2.2; shoot codes; }                   # the sign-in code, on the row and in the reader
feature_palette() { main_view; sclick 600 300 2; key k command 1.6; shoot palette; esc; }
feature_shortcuts() { main_view; key "?" "" 1.6; shoot shortcuts; esc; }
feature_search() { main_view; sclick 800 60 1; ev 'keystroke "from:priya"'; sleep 2.5; shoot search; esc; esc; }

# Inbox Zero: a toy behind an empty view (the demo's empty "Someday" label).
# The first account's Labels list must be open in the sidebar (the demo keeps it).
set_toy() { settings toybox; click "$1" 572 1.2; leave_settings; }   # Pond 806, Bubble wrap 950, Sky 1096
open_someday() { main_view; click 140 592 2; }
feature_bubbles() { set_toy 950; open_someday; shoot inbox-zero-bubbles; }
feature_sky() { set_toy 1096; open_someday; shoot inbox-zero-sky; }

# The writing assistant: a reply idea turned into a draft by Apple Intelligence.
# It leaves a draft reply in the conversation, so take each such picture on a fresh demo.
feature_write_with_ai() {
  main_view; sclick 600 300 2.2; sclick 1006 766 3.5; sclick 835 673 1; sleep 16
  scrolldown 900   # to the bottom of the message, in both themes
  shoot write-with-ai
}

feature_screensaver_settings() { settings toybox; click 950 572 1; scrolldown 420; click 807 527 1; click $scheme 1; shoot screensaver-settings; leave_settings; }   # Koi pond, and the theme's colours
# A screensaver scene over the empty view (Koi pond, Ocean colours), started from the palette.
feature_screensaver() {
  settings toybox; scrolldown 420; click 807 527 1; click $scheme 1; leave_settings
  open_someday; key k command 1.4; ev 'keystroke "screensaver"'; sleep 1; ev "key code 36"; sleep 5
  shoot screensaver
  focus; esc
}


# ---- short loops (mp4 for posts, gif for a page) -----------------------------
# record <name> <seconds> <command...>: a video of the shot's region, with the
# picture behind the window, while the command plays out; then ffmpeg.
record() {
  local clip="$1" most="$2"; shift 2
  mkdir -p "$OUT/loops"
  local left=522 top=230 width=1660 height=960
  "$OUT/bin/backdrop" "$left" "$top" "$width" "$height" "$wallpaper" &
  local picture=$!
  trap 'kill "$picture" 2>/dev/null || true' EXIT INT TERM   # the picture goes away, whatever happens
  sleep 1.2; focus; "$OUT/bin/mouse" 2500 60; sleep 0.6
  rm -f "$OUT/loops/$clip".{mov,mp4,gif}   # screencapture will not overwrite a file
  screencapture -v -V "$most" -R 552,260,1600,900 -x "$OUT/loops/$clip.mov" &
  local recording=$!
  sleep 1
  local began=$SECONDS
  "$@"
  sleep 0.8
  local took=$(( SECONDS - began + 2 ))   # the recording runs on to its limit: keep only what happened
  wait "$recording" 2>/dev/null || true
  kill "$picture" 2>/dev/null || true
  trap - EXIT INT TERM
  ffmpeg -y -loglevel error -i "$OUT/loops/$clip.mov" -t "$took" -an -vf "scale=1600:900" -c:v libx264 -pix_fmt yuv420p -crf 24 -movflags +faststart "$OUT/loops/$clip.mp4"
  ffmpeg -y -loglevel error -i "$OUT/loops/$clip.mov" -t "$took" -an -vf "fps=12,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" -loop 0 "$OUT/loops/$clip.gif"
  echo "loop $clip"
}
# Bubble wrap: single pops at different places and a different pace, then a few
# slow drags across a row (a shot's bubbles are about 38px apart in a row).
pop_naturally() {
  local p
  for p in "560 300" "1010 240" "800 470" "1230 380" "690 610" "1130 560" "960 700"; do
    set -- $p
    "$OUT/bin/drag" $((552 + $1)) $((260 + $2)) $((552 + $1)) $((260 + $2)) 70
    sleep 0.6
  done
  "$OUT/bin/drag" 940 $((260 + 196)) 1980 $((260 + 196)) 1700; sleep 0.7
  "$OUT/bin/drag" 1980 $((260 + 272)) 940 $((260 + 272)) 1700; sleep 0.7
  "$OUT/bin/drag" 940 $((260 + 462)) 1980 $((260 + 462)) 1700; sleep 1
}
feature_loop_bubbles() { set_toy 950; open_someday; record bubble-wrap 24 pop_naturally; }

# Swipe left on a conversation (the app's default: archive), then undo it (the
# app undoes only the latest), for three different rows: the loop ends where it
# started. Rows are about 72px apart in a shot.
swipe_and_undo() {
  local y
  for y in 227 299 443; do
    "$OUT/bin/swipe" $((552 + 700)) $((260 + y)) -520 420; sleep 1.5
    key z "" 1.3
  done
  sleep 0.4
}
feature_loop_swipe() { main_view; record swipe-archive 24 swipe_and_undo; }
feature_loop_koi() {
  settings toybox; scrolldown 420; click 807 527 1; click $scheme 1; leave_settings
  open_someday; key k command 1.4; ev 'keystroke "screensaver"'; sleep 1; ev "key code 36"; sleep 2
  record koi-pond 10 sleep 9
  focus; esc
}
feature_loop_write_with_ai() {
  main_view; sclick 600 300 2.2
  record write-with-ai 75 write_with_ai_steps
}
# The draft is ready when its Replace button shows. Look for it by its colour,
# in the right-hand strip of the window only (the Send button, at the left, is
# the same blue). Prints its centre on screen, "x,y". The main display is 1x.
replace_button() {
  screencapture -x -R 1800,300,264,800 "$OUT/replace.png" 2>/dev/null || return 0
  python3 "$here/find_button.py" "$OUT/replace.png" 1800 300
}
write_with_ai_steps() {
  sclick 1006 766 3.5; sclick 835 673 1
  local where="" tries=0
  while [ -z "$where" ] && [ "$tries" -lt 45 ]; do
    where="$(replace_button)"
    [ -n "$where" ] || { sleep 1; tries=$((tries + 1)); }
  done
  [ -n "$where" ] || { echo "no draft appeared"; return 1; }
  sleep 2.4                                  # time to read it
  ev "click at {${where%,*}, ${where#*,}}"   # Replace
  sleep 1
  scrolldown 900                             # down to the text it put in the message
  sleep 2.6
}

features=("$@")
# The order matters a little: the toys and the screensaver last, since they change settings.
[ ${#features[@]} -gt 0 ] || features=( inbox conversation invitation codes palette shortcuts search
  rules vacation signatures ai ai_apps appearance keyboard list toybox screensaver_settings bubbles sky screensaver
  write_with_ai )   # last: its discard click does not always work, and a draft would stay open
focus
set_theme
keep_unread
# A fresh demo has its Labels lists closed; the toys need the first one open.
# (Set LABELS_OPEN=1 when running on a demo that has been through a pass.)
[ -n "${LABELS_OPEN:-}" ] || { main_view; sclick 148 538 1; }
for f in "${features[@]}"; do "feature_$f"; done

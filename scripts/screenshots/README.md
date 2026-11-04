# Screenshots

How the pictures in `docs/images/features/` (and the README's hero images) are
made, so they can be made again. They are macOS only, and they are pictures of
**demo mode** (made-up people and mail), never of a real mailbox.

The window sits over a picture (a sunset for dark, macOS's own Sonoma for
light), so its see-through parts show something nice instead of whatever is on
the desktop. Each shot is 1600x900 (16:9): good for the README and for a post.

## One-time

- Xcode command line tools (the Swift compiler), `bun`, and Python 3 with
  Pillow (`optimize.py`). The loops also need `ffmpeg` (`brew install ffmpeg`).
- A main display at 1x, as on a 2560x1440 monitor. On a Retina main display
  the pictures come out twice the size, and `find_button.py` (which finds the
  AI loop's Replace button) needs its coordinates doubled.
- macOS permissions for the app that runs the scripts (Terminal, iTerm, an
  editor): **Screen & System Audio Recording** (to capture) and
  **Accessibility** (to click and type). If a capture says "could not create
  image", the entry in Settings may be stale (the app was rebuilt): remove it
  and add the app again.

## Each time

```sh
bun run demo                              # the demo app; wait for its window
OUT=/tmp/shots scripts/screenshots/build.sh   # the helpers and the two wallpapers
OUT=/tmp/shots scripts/screenshots/place.sh   # puts the demo window in its spot
OUT=/tmp/shots scripts/screenshots/gallery.sh dark     # every picture, dark
OUT=/tmp/shots scripts/screenshots/gallery.sh light    # every picture, light
OUT=/tmp/shots scripts/screenshots/gallery.sh dark rules vacation   # just some
OUT=/tmp/shots scripts/screenshots/gallery.sh dark loop_bubbles loop_swipe loop_koi loop_write_with_ai   # the loops
```

Take each AI picture, and the AI loop, on a fresh demo: the writing assistant
leaves a draft reply behind, and the app's undo brings back only the latest
archived conversation. The sign-in code pictures need the popup that arrives
about 45 seconds after the demo opens: run them with `KEEP_TOAST=1` right
then, since every other feature dismisses it.

While it runs, the **main display is in use**: a picture window appears behind
the app for a few seconds per shot, and the script clicks and types at screen
positions. Leave that display alone (or move your windows off it).

Then **look at every picture**. Nothing from a real desktop or a real mailbox
may go into the repository, and a local path (a username) must not show: the
"AI apps" page prints the command path of a dev build, so that shot is scrolled
to keep it below the fold.

```sh
OUT=/tmp/shots scripts/screenshots/install.sh   # into docs/images/features/, sRGB
```

## The pieces

| File | What it does |
|---|---|
| `build.sh` | Compiles the helpers, draws the sunset (`wallpapers/sunset.svg`) and takes a frame of Sonoma |
| `place.sh` | Finds the demo (the process started with `--demo`, never an installed copy) and puts its window at 640,300, 1424x820 |
| `shoot.sh` | One picture: backdrop window, pointer out of the way, region capture |
| `gallery.sh` | One function per feature: the clicks to get there, then `shoot` |
| `install.sh` | Copies the pictures and the loops into the repository; each PNG is recompressed without changing a pixel (`optimize.py`) and carries the plain sRGB profile |
| `find_button.py` | Finds the writing assistant's Replace button by its colour, in the right-hand strip of the window |
| `backdrop.swift`, `windows.swift`, `mouse.swift`, `scroll.swift`, `drag.swift`, `swipe.swift`, `frame.swift`, `render.mjs` | Small helpers: a picture behind the window, window positions, the pointer, scrolling, a hand-like drag, a trackpad swipe, a frame of a video wallpaper, an SVG to PNG |

## Adding a feature

Add a `feature_<name>` function to `gallery.sh` (use `settings <page>`,
`click x y` in window-capture coordinates, `sclick x y` in shot coordinates,
`key`, `scrolldown`, then `shoot <name>`; a loop uses `record <name> <most seconds> <command>`),
add its name to the `features` list, and run it for `dark` and `light`. To find positions, capture just the app's
window (`screencapture -l <window id>`) and read them off the picture.

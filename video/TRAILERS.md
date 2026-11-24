# Trailers

How the trailers are put together, and how to make them again when the app's
screens change. They are 1920x1080 at 60 fps, about 28 seconds each, cut to a
music track's beats. Every picture in them is demo mode: made-up people and
mail, never a real mailbox.

| Composition | What it shows | Code |
|---|---|---|
| `Trailer` | The main trailer: the inbox, summaries, the keyboard, Write with AI, sign-in codes, the command palette | `src/trailer/Trailer.tsx` |
| `TrailerToybox` | Inbox Zero: bubble wrap, the pond, ASCII art, screensavers, the Toybox settings, the sky | `src/trailers/Themed.tsx` |
| `TrailerGmail` | Gmail features: label colors, rules, the vacation responder, invitations, Send again, outside recipients | `src/trailers/Themed.tsx` |
| `TrailerFast` | Search, swipes, shortcuts, the keyboard settings, the command palette, appearance | `src/trailers/Themed.tsx` |

Render one from this folder (`video/`) with
`bunx remotionb render src/index.ts Trailer out/trailer.mp4` (about ten
minutes), or preview it with `bun run studio`. The music and the takes
described below are not in git, so a fresh checkout can't render a trailer
until they are made. The other commands here run
from the repository's top folder.

`render-trailers.sh` renders all four and writes the copies used outside
this folder: a 1280-wide MP4 of each in `website/video/` (the website's
"Watch the trailer" button plays `trailer.mp4`; docs/FEATURES.md and the
README link to them on the website), and the main trailer's end card as
`website/images/trailer.webp`, the video's poster and the picture a shared
link shows. It first checks that the music and the takes are there, and
makes the backdrops with `backdrops.sh` (the light one is a frame of
macOS's Sonoma wallpaper, made on each computer and never committed; a
direct Remotion render needs it too). Watch each one before committing. The trailers'
length is typed by hand on the website's button ("0:28") and in the README's
and FEATURES.md's links ("28 seconds"); `bun run check:website` reads each
video's length from the file and fails until those match it, to the second.

Most shots are of one demo conversation, "Lisbon in May?" (called Lisbon
here): Maya Chen planning a trip, five emails long, with a summary and an
attachment.

## The parts of a trailer

`src/kit/TrailerKit.tsx` holds what they share: the window, the camera, the
captions, the flip from dark to light and the end card. A trailer is a
`TrailerSpec`, which lists:

- `shots`: what the window shows from which frame, in which theme. A shot
  is a picture or a loop in the feature gallery's 1600x900 layout, where the
  window sits at 87,39 and is 1426x822 (its frame is 1424x820 at 88,40; the
  one-pixel outline makes the difference). Only the window is shown, so its
  surroundings in the picture don't matter.
- `moves`: the camera. `view()` makes one cut on a downbeat, a move in
  over a beat and a half, and a slow drift until the next view. A view is
  given as a spot in the window (`fx`, `fy`, in window pixels: a point in a
  1x gallery picture minus 87,39; halve a point in a 2x take first), a zoom (`s`), turns (`rx`, `ry`) and a
  shift on screen (`x`, `y`; `x: 300` keeps the window right of the
  captions).
- `captions`: a small label over a title, each with when it comes in and
  when it has left.
- `flip`: the frame where the light half opens.
- `endBar`: the end card's first bar. The end card is the same in every
  trailer.

Times are written in bars and beats with `at(bar, beat)` from
`src/trailer/beats.ts`, so they follow the music.

## The music

The track is "80s Chillwave Dreamy Outrun" by Osynthw, from Pixabay, under
the Pixabay Content License. That license allows its use in a video but not
sharing the file on its own, so it is not in git: download it from
<https://pixabay.com/music/upbeat-80s-chillwave-dreamy-outrun-345498/> and
save it as `public/music/80s Chillwave Dreamy Outrun.mp3`. The page marks
the track as registered with YouTube's Content ID, so a video posted there
may get a claim; Pixabay says one can usually be cleared by showing its
license.

What the timing depends on (`src/trailer/beats.ts`): 93 BPM (92.98), the
first downbeat at 0.666 s, the beats coming in on the track's bar 5
(11.0 s), a hit on bar 8 (18.75 s) followed by a bar with no beat, and the
full groove from bar 9 (21.31 s). Every trailer starts on the track's bar
3 (`startBar` in `beats.ts`), so:

| Trailer bar | Music | What goes there |
|---|---|---|
| 1–2 | The end of the soft opening | The opening: the inbox rises in and holds |
| 3 | The beats come in | The first feature |
| 4–5 | | Features |
| 6 | The hit, then the hold | A feature that can hold still (or, in the main trailer, Write with AI landing on the hit) |
| 7 | The groove comes in | The flip to light |
| 8 | | The last feature |
| 9–11 | | The end card, then a fade |

To use another track, measure it as this one was: the BPM and the first
downbeat from the beats, and each section's start from where the loudness
jumps. Check the jumps against the grid, since a grid one beat off puts
every cut a beat early or late. Then change the numbers `beats.ts` passes
to `makeGrid` (`src/kit/grid.ts`).

## Where the pictures and loops come from

There are two kinds, and both are made from the demo (`bun run demo`).

**The feature gallery** (`docs/images/features/` and `docs/images/loops/`,
1600x900 at 1x) comes from `scripts/screenshots/` (its README says how to
run it). `gallery.sh` takes a theme and the features to take, and writes to
`$OUT/gallery/<theme>/` and `$OUT/loops/`; `install.sh` then copies them
into `docs/images/`, adding the theme to each name (`feature_rules`, run
dark and light, becomes `rules-dark.png` and `rules-light.png`). A trailer
uses the file in `docs/images/` as it is, so installing a retake updates
the trailer.

**Takes** (`video/public/rec/`, 3200x1800 at 2x, not in git) come from
`video/capture.sh`. They are sharper, for the shots the camera goes close
on. Every trailer needs `inbox-dark.png` (the opening), and `TrailerFast`
needs `palette-light.mp4` too.
`capture.sh` needs a Retina screen: give it that screen's top-left corner
(in points, as `screencapture` counts them), for example the built-in
screen to the right of a 2560-wide monitor:

```sh
OUT=/tmp/shots scripts/screenshots/build.sh   # the helpers and the wallpapers, once
bun run demo                                  # a fresh demo, with the update notice off (docs/DEVELOPMENT.md)
OUT=/tmp/shots SCREEN_X=2560 SCREEN_Y=342 video/capture.sh setup           # the window in place, keep unread, light
# wait for the sign-in code alert, about 45 seconds after the demo opens
OUT=/tmp/shots SCREEN_X=2560 SCREEN_Y=342 video/capture.sh open-codes codes palette dark inbox conversation
# quit the demo, start a fresh one, then:
OUT=/tmp/shots SCREEN_X=2560 SCREEN_Y=342 video/capture.sh setup dark reply-ai
```

Use a fresh demo for each run and don't try a step out before taking it: a
reply opened and closed leaves a draft that changes the next take. The
script stops if the demo isn't the frontmost app or its window has moved,
before any click, key or capture and all through a recording's waits; when
it stops (or on Ctrl-C), it ends the recording and deletes the part made. Look at every take before using it.

| Take | What it is |
|---|---|
| `inbox-dark.png` | The unified Inbox, Lisbon selected (the third row) |
| `conversation-dark.png` | Lisbon open, its summary above the emails |
| `codes-light.png` | The sign-in code alert, Lisbon open behind it |
| `palette-light.mp4` | Lisbon open; ⌘K opens the palette at 2.07 s, and "a", "r", "c", "h" are typed at 3.57, 4.03, 4.47 and 4.93 s |
| `reply-ai.mp4` | Lisbon open; Reply opens at 1.77 s, the AI button opens the panel at 4.13 s, "Confirm the booking" is sent at 6.50 s, the draft is in by 7.9 s |

The times inside a loop decide where in it a shot starts (`from`, in
seconds) and how fast it plays (`rate`). After retaking a loop, measure them
again: this prints the moments the picture changes (the crop is the part to
watch, in pixels of the take):

```sh
ffmpeg -v error -i video/public/rec/palette-light.mp4 -vf "fps=30,crop=1600:900:800:200,scale=160:90" \
  -f rawvideo -pix_fmt gray - | python3 -c "
import sys
d=sys.stdin.buffer.read(); n=160*90; f=[d[i*n:(i+1)*n] for i in range(len(d)//n)]
for i in range(1,len(f)):
    c=sum(abs(a-b) for a,b in zip(f[i],f[i-1]))/n
    if c>0.6: print(f'{i/30:5.2f}s {c:5.1f}')"
```

## Shots of the main trailer

| Bars | Shot | Source | Camera spot | Caption |
|---|---|---|---|---|
| 1–2 | The inbox rises in | take `inbox-dark.png` | the whole window | Unified inbox / One inbox for all your Gmail |
| 3 | Lisbon's summary writes itself in, one line per eighth note | take `conversation-dark.png` | 1000,185, close | Summaries / The gist of a long conversation |
| 4–5½ | K, K, J move the selection, E archives a row | take `inbox-dark.png` | 600,280 | Keyboard first / J and K to move, E to archive |
| 5½–6 | Reply, then the AI button on the hit, then the draft | take `reply-ai.mp4` from 1.72 s at 1.8x | 1040,590 | Write with AI / A first draft of your reply |
| 7 | The flip to light, onto the code alert | take `codes-light.png` | 1253,92, close | Sign-in codes / Copy the code in one click |
| 8 | ⌘K and "arch" typed on eighth notes | take `palette-light.mp4` from 1.9 s at 1.8x | 713,332 | Command palette / Actions and places, from ⌘K |
| 9–11 | The end card | | | All your Gmail accounts, in one calm inbox. |

Two shots are drawn over their picture, and depend on its layout:

- **The keyboard shot** (`KeyboardRows`) cuts the inbox picture into its
  rows (`LIST`: the list at 234,81 in the window, rows 72 pixels apart) and
  moves them. The picture has one row selected (`BAKED_ROW`); a filter
  takes that row's highlight back out (`HIGHLIGHT_LIFT`: the highlight's
  color minus the rows' on either side), a highlight (`SELECTION`) is drawn
  on the row the keys move to (`SELECTED`), and `LIST_BACKGROUND` shows
  where a row has left. If the list's rows, colors or selected row change,
  measure these again in the new picture.
- **The summary** (`SummaryWriting`) hides the summary's three lines
  (`SUMMARY_LINES`, their tops in window pixels, and `SUMMARY_TEXT`, where
  their text runs) behind the card's color (`SUMMARY_CARD`) and wipes them
  away. If the summary card moves or changes color, measure these again.

## Shots of the themed trailers

They share the main trailer's opening (bars 1–2) and end card (bars 9–11).
Bars 3 to 8 hold one feature each, the window turning one way, then the
other; the flip to light comes on bar 7.

**`TrailerToybox`**

| Bar | Shot | Source | Camera spot | Caption |
|---|---|---|---|---|
| 3 | Bubble wrap popped across a row | loop `bubble-wrap.mp4` from 6.6 s (the sweep starts at 7.0 s) | 820,300 | Bubble wrap / Inbox Zero, with bubble wrap |
| 4 | Koi in the pond | loop `koi-pond.mp4` from 2 s | 820,400 | Pond / Koi under an empty inbox |
| 5 | ASCII jellyfish | loop `jellyfish-ascii.mp4` from 2 s | 820,420 | ASCII art / Every toy and screensaver, in ASCII art too |
| 6 | The screensaver scenes and colors | `screensaver-settings-dark.png` | 667,290 | Screensavers / Eleven scenes, six color schemes |
| 7 | The Toybox settings, in light | `toybox-light.png` | 730,290 | Toybox / All the toys, in one settings page |
| 8 | The sky behind an empty label | `inbox-zero-sky-light.png` | 820,420 | Sky / A quiet sky behind an empty inbox |

When the toys or screensavers change, retake their gallery pictures and
loops in both themes, then install them:

```sh
OUT=/tmp/shots scripts/screenshots/gallery.sh dark bubbles sky screensaver screensaver_ascii screensaver_settings toybox loop_bubbles loop_koi loop_jellyfish
OUT=/tmp/shots scripts/screenshots/gallery.sh light sky toybox
OUT=/tmp/shots scripts/screenshots/install.sh
```

Check that each loop still shows its toy in the seconds the shot uses, and
that the captions' counts (scenes, color schemes) still match the app.

**`TrailerGmail`**

| Bar | Shot | Source | Camera spot | Caption |
|---|---|---|---|---|
| 3 | A label's color menu in the sidebar | `labels-dark.png` | 330,640 | Label colors / Gmail's label colors, set from the sidebar |
| 4 | The rule editor | `rules-dark.png` | 706,400 | Rules / Gmail rules, working while the app is closed |
| 5 | The vacation responder | `vacation-dark.png` | 818,360 | Vacation responder / Gmail's out-of-office reply, without a browser |
| 6 | An invitation answered in the email | `invitation-dark.png` | 1040,330 | Invitations / Answer a meeting invite inside the email |
| 7 | Send again, in light | `send-again-light.png` | 1160,450 | Send again / Send an email again, attachments included |
| 8 | The outside-recipient warning | `outside-light.png` | 1040,520 | Outside recipients / A warning before mail leaves your organization |

**`TrailerFast`**

| Bar | Shot | Source | Camera spot | Caption |
|---|---|---|---|---|
| 3 | A search and its results | `search-dark.png` | 700,120 | Search / Search all your Gmail accounts at once |
| 4 | A row swiped away | loop `swipe-archive.mp4` from 0.2 s (the swipe is about a second in) | 820,230 | Swipes / Swipe a conversation away to archive it |
| 5 | The shortcuts sheet (`?`) | `shortcuts-dark.png` | 713,320 | Shortcuts / Gmail's shortcuts, and a cheat sheet on ? |
| 6 | Settings → Keyboard | `keyboard-dark.png` | 825,330 | Keyboard settings / Shortcuts, listed in Settings |
| 7 | ⌘K and "arch", in light | take `palette-light.mp4` from 1.9 s at 1.8x | 713,332 | Command palette / Actions and places, from ⌘K |
| 8 | Settings → Appearance | `appearance-light.png` | 825,460 | Appearance / Light, dark, your accent color and app icon |

## When a screen changes

1. Retake its picture or loop: the gallery feature, or the `capture.sh` take.
2. Look at it. If what the shot is about moved, find its new place in the
   picture, subtract 87,39, and put that in the shot's `fx`, `fy`.
3. For a loop, measure the moments again and update `from` and `rate`.
4. For the main trailer's keyboard and summary shots, measure what they
   draw over (above).
5. Check that the caption still says what the screen shows.
6. Render, and watch it with the sound on.

# Video

Short clips of the app made with [Remotion](https://www.remotion.dev), for the
website, FEATURES.md and posts. Each clip draws the app's own components with
its own stylesheet, so it shows what the app does. Only the input (a finger's
travel, a camera) is scripted. Every frame is drawn from its frame number,
not from the clock, so a render comes out the same each time on the same
machine (fonts come from the computer) and can be slowed down as far as
needed. Like the
screenshots, the clips show only made-up demo mail.

## Clips

| Composition | What it shows |
|---|---|
| `SwipeArchive`, `SwipeArchiveLight` | Swipe to archive, close up: the row slides and the button grows out of it as one shape, then necks and snaps apart (the snap at quarter speed). The two join and part again, and the ring fills until the button lights up. 1920x1080, 60 fps, dark and light. |

## Running

From this folder:

```sh
bun run studio                                            # preview and scrub in the browser
bun run render SwipeArchive out/swipe-archive.mp4         # render one clip
./render.sh                                               # render them all and put the copies in place
```

`render.sh` renders the dark and the light clip into `out/` (ignored by
git) and writes the copies that are used: the website's Swipes card
(a 1280px MP4 per theme in `website/video/`, and its still in `website/images/`) and FEATURES.md's
loop (`docs/images/loops/swipe-archive-closeup.*`, dark). It needs ffmpeg,
cwebp, Python 3 with Pillow and the Xcode command line tools. Look at what it
made before committing it.

## Setup

- Remotion is in the root `package.json`'s `devDependencies`, under the one
  lockfile. `video/package.json` holds only the scripts and marks the folder
  as Remotion's project. It is not a workspace: a workspace would make
  Changesets stop seeing the app as a package, and Bun switch to a layout
  where the app loses packages it reaches through others.
- `remotion.config.ts` runs the CSS through the app's own Tailwind
  (`@tailwindcss/webpack`, at the root's version). The app's stylesheet
  leaves `video/` out of its class names, so the clips' classes never reach
  the app; `src/clip.css` imports it and adds `video/src` back.
- `src/clip.css` also sets the clip's theme (dark or light, from the
  composition), and pauses the app's timed CSS
  (the swipe's snap, and the armed light-up of the button's wash, icon and
  word) so a clip can place it by frame (`--snap`, `--wash`). It restates
  the snap's animation, so a computer set to reduce motion still renders it;
  keep it in step with `.swipe-snap` in `src/styles/index.css`.
- The desktop behind the window is the screenshots' (`scripts/screenshots/`):
  for dark, `public/sunset.png` (from `wallpapers/sunset.svg`); for light,
  a frame of macOS's own Sonoma wallpaper, which `render.sh` makes as
  `public/sonoma.png` and git ignores. Each has a blurred copy (`-blur`)
  standing in for the macOS blur behind the window.

## License

Remotion is source-available, not open source. It is free for individuals,
for-profit organizations of up to 3 people and non-profits; anyone else needs
a company license (see its `LICENSE.md`). It is only used to make these
clips. It never ships in the app.

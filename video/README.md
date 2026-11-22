# Video

Short clips of the app made with [Remotion](https://www.remotion.dev), for the
README, the website and posts. Each clip draws the app's own components with
its own stylesheet, so it shows what the app does. Only the input (a finger's
travel, a camera) is scripted. Every frame comes from the frame number, so a
render can be repeated exactly and slowed down as far as needed. Like the
screenshots, the clips show only made-up demo mail.

## Clips

| Composition | What it shows |
|---|---|
| `SwipeArchive` | Swipe to archive, close up: the row slides and the button grows out of it as one shape, then necks and snaps apart (the snap at quarter speed). The two join and part again, and the ring fills until the button lights up. 1920x1080, 60 fps, dark. |

## Running

From this folder:

```sh
bun run studio                                            # preview and scrub in the browser
bun run render SwipeArchive out/swipe-archive.mp4         # render a clip
```

`out/` is ignored by git. Clips are published by hand, like the loops in
`docs/images/loops/`.

## Setup

- `video/` is a Bun workspace of the root `package.json`, under the same
  lockfile. `bunfig.toml` at the root keeps Bun's hoisted `node_modules`
  layout, which a workspace would otherwise switch off.
- `remotion.config.ts` runs the app's CSS through the app's own Tailwind
  (`@tailwindcss/webpack`, at the root's version), scanning the repository
  for class names.
- `src/video.css` pins the dark theme, and pauses the app's timed CSS (the
  swipe's snap and its armed wash) so a clip can place it by frame
  (`--snap`, `--wash`).
- `public/sunset.png` is the dark screenshots' wallpaper
  (`scripts/screenshots/wallpapers/sunset.svg`). `public/sunset-blur.png` is
  the same picture blurred. It stands in for the macOS blur behind the window.

## License

Remotion is source-available, not open source. It is free for individuals,
for-profit organizations of up to 3 people and non-profits; anyone else needs
a company license (see its `LICENSE.md`). It is only used to make these
clips. It never ships in the app.

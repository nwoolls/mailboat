/**
 * Trailers about one side of the app each, with the main trailer's opening
 * and end card and its track: six features, one bar each, the hold on bar
 * 6 and the flip to light on bar 7, where the track's groove comes in.
 * Captions follow the taglines in docs/FEATURES.md.
 *
 * Their pictures and loops are the feature gallery's (docs/images/, 1x)
 * except the opening and the palette, which are 2x takes (video/capture.sh).
 */
import { staticFile } from "remotion";
import { closing, opening, TrailerFrame, view } from "../kit/TrailerKit";
import type { Caption, Move, Shot, Source, Theme, TrailerSpec } from "../kit/TrailerKit";
import { at, grid } from "../trailer/beats";
import labelsDark from "../../../docs/images/features/labels-dark.png";
import rulesDark from "../../../docs/images/features/rules-dark.png";
import vacationDark from "../../../docs/images/features/vacation-dark.png";
import invitationDark from "../../../docs/images/features/invitation-dark.png";
import sendAgainLight from "../../../docs/images/features/send-again-light.png";
import outsideLight from "../../../docs/images/features/outside-light.png";
import screensaverSettingsDark from "../../../docs/images/features/screensaver-settings-dark.png";
import toyboxLight from "../../../docs/images/features/toybox-light.png";
import skyLight from "../../../docs/images/features/inbox-zero-sky-light.png";
import searchDark from "../../../docs/images/features/search-dark.png";
import shortcutsDark from "../../../docs/images/features/shortcuts-dark.png";
import keyboardDark from "../../../docs/images/features/keyboard-dark.png";
import appearanceLight from "../../../docs/images/features/appearance-light.png";
import bubbleWrap from "../../../docs/images/loops/bubble-wrap.mp4";
import koiPond from "../../../docs/images/loops/koi-pond.mp4";
import jellyfish from "../../../docs/images/loops/jellyfish-ascii.mp4";
import swipeArchive from "../../../docs/images/loops/swipe-archive.mp4";

/** One feature: what the window shows, where the camera looks (window pixels), how close, and its caption. */
type Feature = {
  source: Source;
  theme: Theme;
  fx: number;
  fy: number;
  s: number;
  y?: number;
  eyebrow: string;
  title: string;
};

const END = 9;
const FIRST = 3;

/** A trailer of six features, one bar each from bar 3, between the shared opening and end card. */
function themed(features: Feature[]): TrailerSpec {
  const shots: Shot[] = [
    { start: 0, theme: "dark", source: { still: staticFile("rec/inbox-dark.png") }, name: "inbox" },
  ];
  const moves: Move[] = [...opening(grid, at(FIRST))];
  const captions: Caption[] = [
    {
      from: at(1, 3),
      to: at(FIRST),
      eyebrow: "Unified inbox",
      title: "One inbox for all your Gmail",
    },
  ];
  features.forEach((f, i) => {
    const bar = FIRST + i;
    // The window turns one way, then the other, from one view to the next.
    const side = i % 2 === 0 ? 1 : -1;
    shots.push({ start: at(bar), theme: f.theme, source: f.source, name: f.eyebrow });
    moves.push(
      ...view(
        grid,
        bar,
        1,
        {
          fx: f.fx,
          fy: f.fy,
          s: f.s * 0.85,
          rx: 12,
          ry: 20 * side,
          rz: 0,
          x: 300,
          y: f.y ?? 40,
          z: 0,
        },
        { s: f.s, rx: 6, ry: 10 * side },
        { s: f.s * 1.04, ry: 7 * side },
      ),
    );
    captions.push({ from: at(bar, 1.5), to: at(bar + 1), eyebrow: f.eyebrow, title: f.title });
  });
  moves.push(closing(grid, END));
  return {
    grid,
    shots,
    moves,
    captions,
    flip: at(FIRST + 4),
    endBar: END,
    tagline: "All your Gmail accounts, in one calm inbox.",
  };
}

/** Inbox Zero and the Toybox. */
export const TOYBOX = themed([
  // A sweep of pops starts about 0.4 s into the loop.
  {
    source: { video: bubbleWrap, from: 6.6 },
    theme: "dark",
    fx: 820,
    fy: 300,
    s: 1.2,
    eyebrow: "Bubble wrap",
    title: "Inbox Zero, with bubble wrap",
  },
  {
    source: { video: koiPond, from: 2 },
    theme: "dark",
    fx: 820,
    fy: 400,
    s: 1.1,
    eyebrow: "Pond",
    title: "Koi under an empty inbox",
  },
  {
    source: { video: jellyfish, from: 2 },
    theme: "dark",
    fx: 820,
    fy: 420,
    s: 1.1,
    eyebrow: "ASCII art",
    title: "Every toy and screensaver, in ASCII art too",
  },
  {
    source: { still: screensaverSettingsDark },
    theme: "dark",
    fx: 667,
    fy: 290,
    s: 1.3,
    eyebrow: "Screensavers",
    title: "Eleven scenes, six color schemes",
  },
  {
    source: { still: toyboxLight },
    theme: "light",
    fx: 730,
    fy: 290,
    s: 1.35,
    eyebrow: "Toybox",
    title: "All the toys, in one settings page",
  },
  {
    source: { still: skyLight },
    theme: "light",
    fx: 820,
    fy: 420,
    s: 1.05,
    eyebrow: "Sky",
    title: "A quiet sky behind an empty inbox",
  },
]);

/** What Gmail's own API makes possible. */
export const GMAIL = themed([
  {
    source: { still: labelsDark },
    theme: "dark",
    fx: 330,
    fy: 640,
    s: 1.5,
    y: 0,
    eyebrow: "Label colors",
    title: "Gmail's label colors, set from the sidebar",
  },
  {
    source: { still: rulesDark },
    theme: "dark",
    fx: 706,
    fy: 400,
    s: 1.15,
    eyebrow: "Rules",
    title: "Gmail rules, working while the app is closed",
  },
  {
    source: { still: vacationDark },
    theme: "dark",
    fx: 818,
    fy: 360,
    s: 1.2,
    eyebrow: "Vacation responder",
    title: "Gmail's out-of-office reply, without a browser",
  },
  {
    source: { still: invitationDark },
    theme: "dark",
    fx: 1040,
    fy: 330,
    s: 1.5,
    eyebrow: "Invitations",
    title: "Answer a meeting invite inside the email",
  },
  {
    source: { still: sendAgainLight },
    theme: "light",
    fx: 1160,
    fy: 450,
    s: 1.25,
    eyebrow: "Send again",
    title: "Send an email again, attachments included",
  },
  {
    source: { still: outsideLight },
    theme: "light",
    fx: 1040,
    fy: 520,
    s: 1.45,
    eyebrow: "Outside recipients",
    title: "A warning before mail leaves your organization",
  },
]);

/** Search, the keyboard and the palette. */
export const FAST = themed([
  {
    source: { still: searchDark },
    theme: "dark",
    fx: 700,
    fy: 120,
    s: 1.5,
    y: 120,
    eyebrow: "Search",
    title: "Search all your Gmail accounts at once",
  },
  // A row is swiped away about a second into the loop.
  {
    source: { video: swipeArchive, from: 0.2 },
    theme: "dark",
    fx: 820,
    fy: 230,
    s: 1.35,
    eyebrow: "Swipes",
    title: "Swipe a conversation away to archive it",
  },
  {
    source: { still: shortcutsDark },
    theme: "dark",
    fx: 713,
    fy: 320,
    s: 1.15,
    eyebrow: "Shortcuts",
    title: "Gmail's shortcuts, and a cheat sheet on ?",
  },
  {
    source: { still: keyboardDark },
    theme: "dark",
    fx: 825,
    fy: 330,
    s: 1.25,
    eyebrow: "Keyboard settings",
    title: "Shortcuts, listed in Settings",
  },
  // ⌘K opens at 2.07 s into the 2x take and "arch" is typed from 3.57 s.
  {
    source: { video: staticFile("rec/palette-light.mp4"), from: 1.9, rate: 1.8 },
    theme: "light",
    fx: 713,
    fy: 332,
    s: 1.45,
    eyebrow: "Command palette",
    title: "Actions and places, from ⌘K",
  },
  {
    source: { still: appearanceLight },
    theme: "light",
    fx: 825,
    fy: 460,
    s: 1.2,
    eyebrow: "Appearance",
    title: "Light, dark, your accent color and app icon",
  },
]);

export function ToyboxTrailer({ music }: { music: string | null }) {
  return <TrailerFrame spec={TOYBOX} music={music} />;
}
export function GmailTrailer({ music }: { music: string | null }) {
  return <TrailerFrame spec={GMAIL} music={music} />;
}
export function FastTrailer({ music }: { music: string | null }) {
  return <TrailerFrame spec={FAST} music={music} />;
}

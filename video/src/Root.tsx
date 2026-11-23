import { Composition } from "remotion";
import { DURATION_SECONDS, SwipeArchive } from "./SwipeArchive";
import { Trailer } from "./trailer/Trailer";
import { grid, MUSIC } from "./trailer/beats";
import { FastTrailer, GmailTrailer, ToyboxTrailer } from "./trailers/Themed";

const FPS = 60;
const size = { width: 1920, height: 1080, fps: FPS, durationInFrames: DURATION_SECONDS * FPS };
const trailer = {
  ...size,
  durationInFrames: grid.durationInFrames,
  defaultProps: { music: MUSIC as string | null },
};

export function Root() {
  return (
    <>
      <Composition
        id="SwipeArchive"
        component={SwipeArchive}
        {...size}
        defaultProps={{ theme: "dark" as const }}
      />
      <Composition
        id="SwipeArchiveLight"
        component={SwipeArchive}
        {...size}
        defaultProps={{ theme: "light" as const }}
      />
      {/* The trailers (video/src/trailer, video/src/trailers): music from video/public/music/. */}
      <Composition id="Trailer" component={Trailer} {...trailer} />
      <Composition id="TrailerToybox" component={ToyboxTrailer} {...trailer} />
      <Composition id="TrailerGmail" component={GmailTrailer} {...trailer} />
      <Composition id="TrailerFast" component={FastTrailer} {...trailer} />
    </>
  );
}

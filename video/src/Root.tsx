import { Composition } from "remotion";
import { DURATION_SECONDS, SwipeArchive } from "./SwipeArchive";

const FPS = 60;
const size = { width: 1920, height: 1080, fps: FPS, durationInFrames: DURATION_SECONDS * FPS };

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
    </>
  );
}

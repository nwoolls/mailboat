import { Composition } from "remotion";
import { DURATION_SECONDS, SwipeArchive } from "./SwipeArchive";

const FPS = 60;

export function Root() {
  return (
    <Composition
      id="SwipeArchive"
      component={SwipeArchive}
      width={1920}
      height={1080}
      fps={FPS}
      durationInFrames={DURATION_SECONDS * FPS}
    />
  );
}

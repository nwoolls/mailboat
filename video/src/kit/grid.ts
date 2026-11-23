/**
 * A trailer's clock is its music's: every cut and move is placed in bars
 * and beats, and the grid turns them into frames. A different track means
 * a different BPM and start, nothing else.
 */
export type Grid = {
  fps: number;
  bpm: number;
  /** Where in the track (seconds) the trailer's first bar starts. */
  trackStart: number;
  bars: number;
  /** Frames in a beat and in a bar (4/4). */
  BEAT: number;
  BAR: number;
  durationInFrames: number;
  /** The frame of a bar's beat, both counted from 1 as a musician does: at(5, 2.5) is bar 5's "and" of 2. */
  at: (bar: number, beat?: number) => number;
  /** Beats as frames (a length, not a moment). */
  beats: (n: number) => number;
};

export function makeGrid({
  fps = 60,
  bpm,
  firstDownbeat,
  startBar,
  bars,
}: {
  fps?: number;
  bpm: number;
  /** The track's first downbeat (seconds). */
  firstDownbeat: number;
  /** The track's bar (from 1) the trailer starts on. */
  startBar: number;
  bars: number;
}): Grid {
  const BEAT = (fps * 60) / bpm;
  const BAR = BEAT * 4;
  return {
    fps,
    bpm,
    trackStart: firstDownbeat + (startBar - 1) * ((60 / bpm) * 4),
    bars,
    BEAT,
    BAR,
    durationInFrames: Math.round(bars * BAR),
    at: (bar, beat = 1) => (bar - 1) * BAR + (beat - 1) * BEAT,
    beats: (n) => n * BEAT,
  };
}

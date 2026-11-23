/**
 * The trailers' track (video/public/music/, not in git): "80s Chillwave
 * Dreamy Outrun" from Pixabay, 93 BPM (92.98), its first downbeat at
 * 0.666 s. A soft opening to bar 5 (11.0 s), where the beats come in; a
 * hit on bar 8 (18.75 s) and a bar's hold; the full groove from bar 9
 * (21.31 s). A trailer starts on the track's bar 3, so its bar 3 is where
 * the beats come in, its bar 6 the hold and its bar 7 the groove.
 */
import { makeGrid } from "../kit/grid";

export const MUSIC = "music/80s Chillwave Dreamy Outrun.mp3";
export const grid = makeGrid({ bpm: 92.98, firstDownbeat: 0.666, startBar: 3, bars: 11 });
export const { at, beats, BAR } = grid;

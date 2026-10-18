import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLAGS,
  FEATURE_FLAGS,
  FLAGS_STORAGE_KEY,
  parseFlags,
  setFeatureFlag,
} from "./featureFlags";

describe("feature flags", () => {
  it("defaults anything missing or unreadable", () => {
    expect(parseFlags(null)).toEqual(DEFAULT_FLAGS);
    expect(parseFlags("not json")).toEqual(DEFAULT_FLAGS);
    expect(parseFlags('{"emptyGlow":"yes","other":true}')).toEqual(DEFAULT_FLAGS);
  });

  it("keeps saved choices", () => {
    expect(parseFlags('{"emptyGlow":false}')).toEqual({ ...DEFAULT_FLAGS, emptyGlow: false });
  });

  it("remembers a change", () => {
    setFeatureFlag("sandscape", false);
    expect(parseFlags(localStorage.getItem(FLAGS_STORAGE_KEY)).sandscape).toBe(false);
    setFeatureFlag("sandscape", true);
    expect(parseFlags(localStorage.getItem(FLAGS_STORAGE_KEY)).sandscape).toBe(true);
  });

  it("lists every flag once in Settings", () => {
    expect(FEATURE_FLAGS.map((f) => f.id).toSorted()).toEqual(
      Object.keys(DEFAULT_FLAGS).toSorted(),
    );
  });
});

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
    expect(parseFlags('{"screensavers":"yes","other":true}')).toEqual(DEFAULT_FLAGS);
  });

  it("keeps saved choices", () => {
    expect(parseFlags('{"screensavers":false}')).toEqual({ ...DEFAULT_FLAGS, screensavers: false });
  });

  it("remembers a change", () => {
    setFeatureFlag("screensavers", false);
    expect(parseFlags(localStorage.getItem(FLAGS_STORAGE_KEY)).screensavers).toBe(false);
    setFeatureFlag("screensavers", true);
    expect(parseFlags(localStorage.getItem(FLAGS_STORAGE_KEY)).screensavers).toBe(true);
  });

  it("lists every flag once in Settings", () => {
    expect(FEATURE_FLAGS.map((f) => f.id).toSorted()).toEqual(
      Object.keys(DEFAULT_FLAGS).toSorted(),
    );
  });
});

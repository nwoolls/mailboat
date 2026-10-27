import { localStore } from "../../../shared/lib/localStore";
import { ONBOARDING_KEY, type Progress, parseProgress } from "../model/onboarding";

/** Onboarding's progress, window-only (see `model/onboarding.ts`). */
export const onboarding = localStore(ONBOARDING_KEY, parseProgress);

/** Changes part of the progress (saving it, which marks it started). */
export function updateProgress(change: Partial<Progress>) {
  onboarding.set({ ...onboarding.get(), ...change, started: true });
}

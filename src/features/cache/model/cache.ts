/**
 * The words for the encrypted mail cache's two moments that reach the
 * window: it couldn't be opened (a screen with Try again and Quit), and a
 * new cache was started because its key was gone (a notice, once). See
 * `mail_core::db::cache`.
 */

import type { StartupProblem } from "../../../platform/tauri/bindings";
import type { Platform } from "../../../shared/lib/platform";

/** Where the system keeps the cache's key, as each system names it. */
export function keychainName(platform: Platform): string {
  switch (platform) {
    case "mac":
      return "Keychain";
    case "windows":
      return "Credential Manager";
    case "linux":
      return "your desktop's keyring";
  }
}

export type Words = { title: string; body: string };

/** The screen shown instead of the mail when the cache couldn't be opened. */
export function problemWords(problem: StartupProblem, platform: Platform, appName: string): Words {
  switch (problem) {
    case "keychain":
      return {
        title: "Can't unlock your mail",
        body: `${appName} couldn't read its key from ${keychainName(platform)}. Unlock ${keychainName(platform)} or let ${appName} use it, then try again. Your mail stays as it is.`,
      };
    case "inUse":
      return {
        title: `Another copy of ${appName} is open`,
        body: `It has your mail open. Quit it, then try again. Your mail stays as it is.`,
      };
  }
}

/** The notice shown once after a new cache was started. */
export function resetWords(platform: Platform, appName: string): Words {
  return {
    title: "Your mail was reset on this computer",
    body: `The key that unlocks it was missing from ${keychainName(platform)} or didn't match, so ${appName} started again. Sign in to your accounts again and your mail downloads from Gmail. Settings are back to their defaults.`,
  };
}

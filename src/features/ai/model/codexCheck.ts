import type { CodexCheck } from "../../../platform/tauri/bindings";
import { APP_NAME } from "../../../shared/lib/brand";

/** What Settings → AI says about Codex's review, if anything. */
export type CodexNotice = {
  title: string;
  body: string;
  /** Codex switches that haven't been reviewed and stay on. */
  switches: string[];
  /** Offer "Use anyway" (only for unreviewed switches, not a failed check). */
  canUseAnyway: boolean;
};

/**
 * ChatGPT runs through Codex, which can't promise no tools, so every
 * request turns all of Codex's switches off and pauses if one it hasn't
 * reviewed stays on (Milestone 13). Nothing to say when ChatGPT isn't
 * connected or all is as reviewed.
 */
export function codexNotice(
  check: CodexCheck | undefined,
  chatgptConnected: boolean,
): CodexNotice | null {
  if (!check || !chatgptConnected) return null;
  if (check.failed)
    return {
      title: "ChatGPT is paused",
      body: `${APP_NAME} couldn’t check Codex’s settings, so nothing goes to ChatGPT until it can. Features set to ChatGPT will say so; another provider still works.`,
      switches: [],
      canUseAnyway: false,
    };
  if (check.unreviewed.length === 0) return null;
  if (check.accepted)
    return {
      title: "Using ChatGPT anyway",
      body: `Until ${APP_NAME} quits, ChatGPT is used even though Codex has settings that haven’t been reviewed and won’t turn off.`,
      switches: check.unreviewed,
      canUseAnyway: false,
    };
  return {
    title: "ChatGPT is paused",
    body: `Codex now has settings ${APP_NAME} hasn’t reviewed that won’t turn off, so it could do more than write text. Features set to ChatGPT wait until it’s checked; another provider still works.`,
    switches: check.unreviewed,
    canUseAnyway: true,
  };
}

// Fails when Codex's review (crates/core/src/ai/codex_review.json) is more
// than 31 days old: Codex can't promise no tools, so an agent rechecks it
// monthly (AGENTS.md → Codex review). In automated builds (CI) it only
// warns, so old commits and builds still pass. A date that can't be used
// fails everywhere. Run by `bun run check:web` and `check:quick`.
import review from "../crates/core/src/ai/codex_review.json";
import { reviewAge } from "./codexReviewAge";

const MAX_DAYS = 31;
const age = reviewAge(review.reviewed, new Date());

if ("invalid" in age) {
  console.error(`check:codex: codex_review.json's "reviewed" date can't be used: ${age.invalid}`);
  process.exit(1);
}
if (age.days > MAX_DAYS) {
  const message = [
    `check:codex: Codex was last reviewed ${age.days} days ago (${review.reviewed}); it's due every ${MAX_DAYS}.`,
    "Agent: stop and ask the owner before going on. With their OK, follow AGENTS.md → Codex review",
    "(capture Codex's tools, run the live tests, update crates/core/src/ai/codex_review.json).",
  ].join("\n");
  if (process.env.CI) {
    console.warn(message);
  } else {
    console.error(message);
    process.exit(1);
  }
} else {
  console.log(`check:codex: Codex reviewed ${age.days} day(s) ago (${review.reviewed})`);
}

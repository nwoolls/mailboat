// Fails when a system's Codex review (crates/core/src/ai/codex_review.json,
// one per system: macOS and Windows) is more than 31 days old; a system
// never reviewed only warns: Codex can't promise no tools, so an agent rechecks it
// monthly (AGENTS.md → Codex review). It only fails where the owner has
// asked for it, with an empty, uncommitted `.codex-review-enforce` file in
// the repository folder; everywhere else (CI, a clone by someone else, old
// commits) it warns. A date that can't be used fails everywhere. Run by
// `bun run check:web` and `check:quick`.
import { existsSync } from "node:fs";
import review from "../crates/core/src/ai/codex_review.json";
import { reviewStatuses } from "./codexReviewAge";

const MAX_DAYS = 31;
const statuses = reviewStatuses(review.platforms, new Date(), MAX_DAYS);

const invalid = statuses.filter((s) => s.state === "invalid");
for (const s of invalid)
  console.error(`check:codex: ${s.platform}'s review date can't be used: ${s.why}`);
if (invalid.length) process.exit(1);

for (const s of statuses) {
  if (s.state === "fine")
    console.log(`check:codex: ${s.platform}: Codex reviewed ${s.days} day(s) ago`);
  if (s.state === "never")
    console.warn(
      `check:codex: ${s.platform}: Codex has never been reviewed there. It warns until the first review, then is due monthly like the others.`,
    );
}
const due = statuses.filter((s) => s.state === "due");
if (due.length) {
  const message = [
    ...due.map(
      (s) =>
        `check:codex: ${s.platform}: Codex was last reviewed ${s.days} days ago (${s.reviewed}); it's due every ${MAX_DAYS}.`,
    ),
    "Agent: stop and ask the owner before going on. With their OK, follow AGENTS.md → Codex review",
    "on each system that's due (capture Codex's tools, run the live tests, update crates/core/src/ai/codex_review.json).",
  ].join("\n");
  if (process.env.CI || !existsSync(new URL("../.codex-review-enforce", import.meta.url))) {
    console.warn(message);
  } else {
    console.error(message);
    process.exit(1);
  }
}

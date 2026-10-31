// Fails when Codex's review (crates/core/src/ai/codex_review.json) is more
// than 31 days old: Codex can't promise no tools, so an agent rechecks it
// monthly (AGENTS.md → Codex review). In automated builds (CI) it only
// warns, so old commits and builds still pass. Run by `bun run check:web`.
import review from "../crates/core/src/ai/codex_review.json";

const MAX_DAYS = 31;
const reviewed = new Date(`${review.reviewed}T00:00:00`);
const days = Math.floor((Date.now() - reviewed.getTime()) / 86_400_000);

if (Number.isNaN(days)) {
  console.error(`check:codex: codex_review.json has no valid "reviewed" date: ${review.reviewed}`);
  process.exit(1);
}
if (days > MAX_DAYS) {
  const message = [
    `check:codex: Codex was last reviewed ${days} days ago (${review.reviewed}); it's due every ${MAX_DAYS}.`,
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
  console.log(`check:codex: Codex reviewed ${days} day(s) ago (${review.reviewed})`);
}

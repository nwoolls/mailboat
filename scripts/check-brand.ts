// Fails if the app's name, short name or bundle ID (from brand.json) is
// written anywhere but the few files that hold the brand. Everything else
// takes it from brand.json (Rust: mail_core::brand, UI: shared/lib/brand),
// so a new name is one file. Run by `bun run check:web`.
import brand from "../brand.json";

/** Where the brand may be written by hand. */
const ALLOWED = [
  "brand.json",
  // Tauri reads these itself; a test keeps them in step with brand.json.
  "src-tauri/tauri.conf.json",
  "src-tauri/tauri.windows.conf.json",
  // Prose and artwork, updated with the name by hand.
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "docs/",
  "CONTRIBUTING.md",
  "SECURITY.md",
  ".github/ISSUE_TEMPLATE/",
  ".github/pull_request_template.md",
  ".github/FUNDING.yml",
  "design/",
  // Generated.
  "bun.lock",
  "Cargo.lock",
];

const terms = [brand.name, brand.shortName, brand.id];
const pattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const grep = Bun.spawnSync(["git", "grep", "--untracked", "-n", "-I", "-i", "-E", pattern], {
  stdout: "pipe",
});
const hits = grep.stdout
  .toString()
  .split("\n")
  .filter((line) => line && !ALLOWED.some((a) => line.startsWith(a.endsWith("/") ? a : `${a}:`)));

if (hits.length) {
  console.error(
    `The app's name is written in ${hits.length} place(s) outside brand.json. Use mail_core::brand (Rust), APP_NAME (UI) or "the app" (comments):`,
  );
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
console.log("check:brand: the name lives in brand.json");

// Draws the icons of the taskbar icon's menu on Windows (its jump list,
// src-tauri/src/jump_list.rs) from the sidebar's own Hugeicons
// (src/shared/ui/icons.tsx), and turns each into an .ico.
//
//   bun scripts/build-jump-list-icons.ts
//
// Writes design/jump-list/<name>.svg (the drawing, to look at) and
// src-tauri/icons/jump-list/<name>.ico (16 to 256 px, through `tauri icon`),
// which the Windows installer ships (tauri.windows.conf.json → resources).
// The menu follows Windows' light or dark theme but its icons can't, so
// they're a gray that reads on both.
import { mkdirSync, mkdtempSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ArchiveArrowDown from "@hugeicons/core-free-icons/ArchiveArrowDownIcon";
import File01 from "@hugeicons/core-free-icons/File01Icon";
import Inbox from "@hugeicons/core-free-icons/InboxIcon";
import Mail02 from "@hugeicons/core-free-icons/Mail02Icon";
import Mails from "@hugeicons/core-free-icons/MailsIcon";
import PencilEdit02 from "@hugeicons/core-free-icons/PencilEdit02Icon";
import Star from "@hugeicons/core-free-icons/StarIcon";

/** Gray with at least 3:1 contrast on the menu's light and dark backgrounds. */
export const GRAY = "#858585";
/** The sidebar's stroke (`icons.tsx`, 1.75 on a 24-unit grid). */
const STROKE = "1.75";

type Shape = readonly [string, Record<string, string | number>];

/** File name (jump_list.rs `icon`) → the sidebar's icon for it. */
export const ICONS: Record<string, readonly Shape[]> = {
  "new-message": PencilEdit02,
  inbox: Inbox,
  unread: Mail02,
  starred: Star,
  drafts: File01,
  archive: ArchiveArrowDown,
  "all-mail": Mails,
};

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function svg(shapes: readonly Shape[], color = GRAY): string {
  const body = shapes
    .map(([tag, attrs]) => {
      const out = Object.entries(attrs)
        .filter(([k]) => k !== "key")
        .map(([k, v]) => {
          const value = k === "strokeWidth" ? STROKE : String(v).replace("currentColor", color);
          return `${kebab(k)}="${value}"`;
        });
      return `<${tag} ${out.join(" ")}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 24 24" fill="none">${body}</svg>\n`;
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  const svgDir = join(root, "design/jump-list");
  const icoDir = join(root, "src-tauri/icons/jump-list");
  mkdirSync(svgDir, { recursive: true });
  mkdirSync(icoDir, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "jump-list-"));
  try {
    for (const [name, shapes] of Object.entries(ICONS)) {
      const source = join(svgDir, `${name}.svg`);
      writeFileSync(source, svg(shapes));
      const out = join(tmp, name);
      const run = Bun.spawnSync(["bun", "tauri", "icon", source, "-o", out], {
        cwd: root,
        stdout: "ignore",
        stderr: "inherit",
      });
      if (run.exitCode !== 0) throw new Error(`tauri icon failed for ${name}`);
      copyFileSync(join(out, "icon.ico"), join(icoDir, `${name}.ico`));
      console.log(`${name}.ico`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

import { useEffect, useState } from "react";
import { commands, events } from "../../../platform/tauri/bindings";
import { IS_TAURI, unwrap } from "../../../platform/tauri/ipc";
import { showToast } from "../../../shared/lib/toast";
import { ImageIcon, LinkIcon, PopOutIcon, SaveIcon } from "../../../shared/ui/icons";
import { Menu, type MenuAnchor, MenuItem, MenuSeparator } from "../../../shared/ui/Menu";
import { type EmailMenuTarget, emailMenuItems, emailMenuTarget } from "../model/emailMenu";

/**
 * What's under the pointer in the email at page point (x, y). WebKit runs
 * nothing inside an email's frame, so it can't say; the frame's `:hover`
 * state still follows the pointer, and its deepest element is the one
 * clicked (unaffected by the email's text-size zoom, unlike coordinates).
 */
function targetAt(x: number, y: number): EmailMenuTarget | null {
  const frame = document.elementFromPoint(x, y)?.closest("iframe[data-message-id]");
  const doc = frame instanceof HTMLIFrameElement ? frame.contentDocument : null;
  if (!doc) return null;
  const hovered = doc.querySelectorAll(":hover");
  const r = frame!.getBoundingClientRect();
  const el = hovered[hovered.length - 1] ?? doc.elementFromPoint(x - r.left, y - r.top);
  const target = emailMenuTarget(el);
  return target.image || target.link ? target : null;
}

/**
 * Mailboat's right-click menu over an image or link in an email: Save Image
 * (to Downloads), Copy Image, Open Link, Copy Link. Rust empties WebKit's
 * own menu there and says where the click was (`email_menu.rs`); over
 * text, the system menu stays.
 */
export function EmailContextMenu() {
  const [open, setOpen] = useState<{ anchor: MenuAnchor; target: EmailMenuTarget } | null>(null);

  useEffect(() => {
    if (!IS_TAURI) return;
    const unlisten = events.emailMenuEvent.listen(({ payload }) => {
      // Rust's floats arrive as `number | null` (null for NaN, never sent).
      const x = payload.x ?? 0;
      const y = payload.y ?? 0;
      const target = targetAt(x, y);
      if (target) setOpen({ anchor: { x, y }, target });
    });
    return () => void unlisten.then((fn) => fn());
  }, []);

  if (!open) return null;
  const { image, link } = open.target;
  const items = emailMenuItems(open.target);
  const run = (what: string, action: () => Promise<unknown>) => {
    setOpen(null);
    action().catch((e: Error) =>
      showToast({ tone: "error", message: `Couldn’t ${what}: ${e.message}` }),
    );
  };

  return (
    <Menu anchor={open.anchor} onClose={() => setOpen(null)} label="Email">
      {items.includes("saveImage") && (
        <MenuItem
          icon={SaveIcon}
          onSelect={() =>
            run("save the image", async () => {
              const name = await unwrap(commands.emailImageSave(image!));
              showToast({
                message: `Saved “${name}” to Downloads`,
                action: {
                  label: "Show in Finder",
                  run: () => void unwrap(commands.downloadReveal(name)).catch(() => {}),
                },
              });
            })
          }
        >
          Save Image
        </MenuItem>
      )}
      {items.includes("copyImage") && (
        <MenuItem
          icon={ImageIcon}
          onSelect={() =>
            run("copy the image", async () => {
              await unwrap(commands.emailImageCopy(image!));
              showToast({ message: "Image copied" });
            })
          }
        >
          Copy Image
        </MenuItem>
      )}
      {image && link && <MenuSeparator />}
      {items.includes("openLink") && (
        <MenuItem
          icon={PopOutIcon}
          onSelect={() => run("open the link", () => unwrap(commands.emailLinkOpen(link!)))}
        >
          Open Link
        </MenuItem>
      )}
      {items.includes("copyLink") && (
        <MenuItem
          icon={LinkIcon}
          onSelect={() =>
            run("copy the link", async () => {
              await unwrap(commands.emailLinkCopy(link!));
              showToast({ message: "Link copied" });
            })
          }
        >
          Copy Link
        </MenuItem>
      )}
    </Menu>
  );
}

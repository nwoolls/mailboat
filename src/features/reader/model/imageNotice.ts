import type { OpenedMessage } from "../../../platform/tauri/bindings";

/**
 * The line above an email about its remote images. `quiet` notices (images
 * loaded) are plain small text; the rest are the tinted bar.
 */
export type ImageNotice = {
  text: string;
  /** Saves a per-sender choice: `allow` true loads, false blocks. The
   * sender's address goes in `hint` (a tooltip) to keep the line short. */
  action: { label: string; hint: string; allow: boolean } | null;
  quiet: boolean;
};

type Message = Pick<
  OpenedMessage,
  "imagePolicy" | "blockedImages" | "loadedImages" | "trackersRemoved" | "senderEmail"
>;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(" · ");

export function imageNotice(m: Message): ImageNotice | null {
  const trackers = m.trackersRemoved > 0 ? `${plural(m.trackersRemoved, "tracker")} removed` : null;

  switch (m.imagePolicy) {
    case "loadedByDefault":
    case "loadedForSender":
      if (m.loadedImages === 0 && !trackers) return null;
      return {
        text: join(m.loadedImages > 0 ? "Images shown" : null, trackers),
        action:
          m.loadedImages > 0
            ? { label: "Block images", hint: `Block images from ${m.senderEmail}`, allow: false }
            : null,
        quiet: true,
      };
    case "blockedForSender":
    case "blockedByDefault":
    case "blockedNotWrittenTo":
    case "blockedInTrash":
    case "blockedInSpam": {
      if (m.blockedImages === 0 && !trackers) return null;
      const where =
        m.imagePolicy === "blockedInSpam"
          ? " in Spam"
          : m.imagePolicy === "blockedInTrash"
            ? " in Trash"
            : "";
      const hidden =
        m.blockedImages > 0 ? `${plural(m.blockedImages, "remote image")} hidden${where}` : null;
      return {
        text: join(hidden, trackers),
        // Spam never loads images, even for a sender you trust: addresses
        // there are often forged.
        action:
          m.imagePolicy !== "blockedInSpam" && m.blockedImages > 0
            ? { label: "Load images", hint: `Load images from ${m.senderEmail}`, allow: true }
            : null,
        quiet: false,
      };
    }
  }
}

import type { Attachment } from "../../../platform/tauri/bindings";

/** "820 B", "14 KB", "2.4 MB", as Finder rounds them (1 KB = 1000 bytes). */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)} ${units[unit]}`;
}

export type FileKind = "image" | "pdf" | "file";

/** Which icon an attachment gets. */
export function fileKind(a: Pick<Attachment, "mimeType" | "filename">): FileKind {
  const mime = a.mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || a.filename.toLowerCase().endsWith(".pdf")) return "pdf";
  return "file";
}

/** The name shown: no folders (an email can name a file "../x.pdf"). */
export function shownName(a: Pick<Attachment, "filename">): string {
  return a.filename.split(/[/\\]/).pop()?.trim() || "attachment";
}

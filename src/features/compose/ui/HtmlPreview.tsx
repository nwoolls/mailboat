import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { commands } from "../../../platform/tauri/bindings";
import { IS_TAURI } from "../../../platform/tauri/ipc";

/**
 * Mail HTML shown as the reader shows email: sanitized in Rust and, where
 * possible, "adaptive", sitting on the glass with colours adjusted for
 * dark mode (mail with its own style sheet keeps a white card). Sandboxed
 * without scripts; same-origin only so its height can be read.
 */
export function HtmlPreview({ title, html }: { title: string; html: string }) {
  const preview = useQuery({
    queryKey: ["htmlPreview", html],
    queryFn: () => commands.htmlPreview(html),
    enabled: IS_TAURI,
    staleTime: Infinity,
  });
  const [height, setHeight] = useState(0);
  if (!preview.data) return null;
  return (
    <iframe
      title={title}
      sandbox="allow-same-origin"
      srcDoc={preview.data.document}
      onLoad={(e) => {
        const doc = e.currentTarget.contentDocument;
        if (!doc) return;
        const measure = () => setHeight(doc.documentElement.scrollHeight);
        measure();
        for (const img of Array.from(doc.images)) img.addEventListener("load", measure);
      }}
      style={{ height }}
      className={`block w-full ${
        preview.data.adaptive ? "bg-transparent" : "rounded-md bg-white ring-1 ring-stroke"
      }`}
    />
  );
}

import { useEffect, useRef, useState } from "react";
import { type CheckedClient, commands } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { IS_MAC } from "../../../shared/lib/platform";
import { FileUploadIcon } from "../../../shared/ui/icons";
import { clientFileFromPaste, plainError } from "../model/onboarding";

/** How often "Watch my Downloads" looks for the file. */
const WATCH_MS = 1500;

/**
 * Takes the Desktop client's file however it comes: dropped anywhere on
 * the window, chosen, spotted in Downloads, or pasted as an ID and secret.
 * Rust checks it and says plainly what's wrong (a Web client, no secret).
 */
export function ClientDrop({ onSaved }: { onSaved: (client: CheckedClient) => void }) {
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const saved = useRef(onSaved);
  useEffect(() => {
    saved.current = onSaved;
  }, [onSaved]);

  const save = async (text: string) => {
    try {
      const client = await unwrap(commands.oauthClientSave(text));
      setError(null);
      saved.current(client);
    } catch (e) {
      setError(plainError(e));
    }
  };

  // The whole window takes the drop (the window's own file drop is off, so
  // the page gets it).
  useEffect(() => {
    let depth = 0;
    const isFile = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const onEnter = (e: DragEvent) => {
      if (!isFile(e)) return;
      depth++;
      setOver(true);
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const onOver = (e: DragEvent) => {
      if (isFile(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!isFile(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const file = e.dataTransfer?.files[0];
      if (file) void file.text().then(save);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  // Looks in Downloads until the file turns up (or something goes wrong).
  useEffect(() => {
    if (!watching) return;
    let stopped = false;
    const look = async () => {
      try {
        const client = await unwrap(commands.oauthClientFromDownloads());
        if (stopped) return;
        if (client) {
          setWatching(false);
          setError(null);
          saved.current(client);
        }
      } catch (e) {
        if (stopped) return;
        setWatching(false);
        setError(plainError(e));
      }
    };
    void look();
    const timer = window.setInterval(() => void look(), WATCH_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [watching]);

  return (
    <div className="space-y-3">
      <div
        data-over={over || undefined}
        className="onb-drop flex flex-col items-center gap-2 rounded-xl border border-dashed border-content/20 px-6 py-7 text-center transition-colors duration-150"
      >
        <FileUploadIcon size={26} strokeWidth={1.5} className="text-content/50" />
        <p className="font-medium">Drop the downloaded file here</p>
        <p className="text-[12px] text-content/55">
          Anywhere on the window. It’s named <code>client_secret_….json</code>.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="rounded-md bg-selection-strong px-3 py-1.5 text-[12px] hover:bg-selection"
          >
            Choose file…
          </button>
          <button
            type="button"
            onClick={() => setWatching((w) => !w)}
            aria-pressed={watching}
            title={
              IS_MAC ? "macOS asks once to let the app look in your Downloads folder." : undefined
            }
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-selection aria-pressed:bg-accent/15 aria-pressed:text-accent"
          >
            {watching ? "Watching Downloads…" : "Watch my Downloads"}
          </button>
          <button
            type="button"
            onClick={() => setPasting((p) => !p)}
            aria-expanded={pasting}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-selection"
          >
            Paste ID and secret
          </button>
        </div>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void file.text().then(save);
          }}
        />
      </div>
      {pasting && (
        <form
          className="onb-rise space-y-2 rounded-xl bg-selection-subtle p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save(clientFileFromPaste(id, secret));
          }}
        >
          <p className="text-[12px] text-content/60">
            Google’s “OAuth client created” box shows both. Copy each one here.
          </p>
          <input
            aria-label="Client ID"
            placeholder="Client ID (…apps.googleusercontent.com)"
            value={id}
            onChange={(e) => setId(e.target.value)}
            spellCheck={false}
            className="w-full rounded-md border border-content/12 bg-transparent px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
          />
          <input
            aria-label="Client secret"
            placeholder="Client secret"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            spellCheck={false}
            className="w-full rounded-md border border-content/12 bg-transparent px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!id.trim() || !secret.trim()}
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
            >
              Use these
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="selectable onb-rise text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

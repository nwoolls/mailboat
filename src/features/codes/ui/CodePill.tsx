import { useState } from "react";
import { commands } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { showToast } from "../../../shared/lib/toast";

/**
 * A recent sign-in code on its conversation's row: clicking copies it
 * (without opening the email), as GotEmail's pill does.
 */
export function CodePill({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy sign-in code ${code}`}
      onClick={(e) => {
        // Not the row's click, which would open the conversation.
        e.stopPropagation();
        void unwrap(commands.textCopy(code))
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          })
          .catch((err: unknown) =>
            showToast({
              tone: "error",
              message: `Couldn’t copy: ${err instanceof Error ? err.message : String(err)}`,
            }),
          );
      }}
      className="ml-2 shrink-0 rounded-md bg-accent/15 px-1.5 py-px font-mono text-[11px] font-semibold tracking-wide text-accent hover:bg-accent/25"
    >
      {copied ? "Copied" : code}
    </button>
  );
}

import type { MessageId } from "../../../platform/tauri/bindings";
import { ClearIcon, TranslateIcon } from "../../../shared/ui/icons";
import { languageName } from "../model/translate";
import { closeTranslation, useTranslation } from "./translations";

/**
 * The translation of text selected in this email (Translate selection),
 * above it (below the images line), leaving the email itself as it was.
 */
export function TranslationCard({ messageId }: { messageId: MessageId }) {
  const t = useTranslation(messageId);
  if (!t) return null;
  const from = t.state === "done" && t.source ? `from ${languageName(t.source)} ` : "";
  return (
    <section
      aria-label="Translation"
      aria-busy={t.state === "working"}
      className="mb-3 rounded-[10px] px-3.5 pt-2 pb-2.5 ring-1 ring-stroke ring-inset"
    >
      <header className="flex h-6 items-center gap-1.5 text-xs text-content/50">
        <TranslateIcon
          size={13}
          className={`text-accent ${t.state === "working" ? "animate-pulse" : ""}`}
        />
        <span className="font-medium text-content/70">
          {t.state === "working" ? "Translating…" : "Translation"}
        </span>
        {t.state === "done" && (
          <span>
            · {from}by {t.by}
          </span>
        )}
        <button
          type="button"
          aria-label="Close translation"
          title="Close"
          onClick={() => closeTranslation(messageId)}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-md hover:bg-selection hover:text-content"
        >
          <ClearIcon size={13} />
        </button>
      </header>
      {t.state === "done" && (
        <p className="selectable mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-content/85">
          {t.text}
        </p>
      )}
      {t.state === "failed" && (
        <p className="selectable mt-1 text-xs text-danger">Couldn’t translate: {t.message}</p>
      )}
      {t.state === "working" && (
        <div className="mt-1.5 h-3 w-2/3 animate-pulse rounded bg-selection" />
      )}
    </section>
  );
}

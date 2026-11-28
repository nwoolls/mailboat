import { Command } from "cmdk";
import { useEffect, useRef } from "react";
import type { Template } from "../../../platform/tauri/bindings";
import { recentFirst } from "../model/apply";
import { previewLine } from "../model/fields";

/** Asks the app to open Settings → Templates, at a template's editor or a new one. */
export const TEMPLATE_SETTINGS_EVENT = "app:template-settings";
export type TemplateSettingsTarget = { edit: Template["id"] | "new" | null };

export function openTemplateSettings(target: TemplateSettingsTarget = { edit: null }) {
  window.dispatchEvent(new CustomEvent(TEMPLATE_SETTINGS_EVENT, { detail: target }));
}

/** "4 fields", "1 field", or "". */
export function fieldCount(t: Pick<Template, "fields">): string {
  const n = t.fields.length;
  return n === 0 ? "" : n === 1 ? "1 field" : `${n} fields`;
}

/** A template's subject, or else its first words, with fields as `{Name}`. */
export function templateLine(t: Pick<Template, "subject" | "body">): string {
  return previewLine(t.subject) || previewLine(t.body);
}

/**
 * The composer's list of templates, over the Templates button: type to
 * filter, ↑ ↓ and Return to pick, Esc or a click elsewhere to close.
 */
export function TemplatePicker({
  templates,
  canSaveAs,
  onPick,
  onSaveAs,
  onClose,
}: {
  templates: Template[];
  /** Something is written that could become a template. */
  canSaveAs: boolean;
  onPick: (t: Template) => void;
  onSaveAs: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !box.current?.contains(e.target)) onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [onClose]);
  const GROUP =
    "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-content/45";
  const item =
    "flex cursor-default flex-col gap-0.5 rounded-md px-2.5 py-1.5 data-[selected=true]:bg-selection-strong";
  return (
    <div
      ref={box}
      className="dialog absolute right-0 bottom-full z-30 mb-2 w-[22rem] max-w-[80vw] overflow-hidden rounded-xl text-[13px] text-content"
    >
      <Command
        label="Templates"
        loop
        onKeyDown={(e) => {
          // Its keys are its own: ⌘↩ here mustn't send the message.
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <Command.Input
          ref={input}
          placeholder="Find a template…"
          className="h-9 w-full border-b border-stroke bg-transparent px-3 outline-none placeholder:text-content/40"
        />
        <Command.List className="max-h-72 overflow-y-auto p-1">
          <Command.Empty className="px-3 py-2 text-content/50">
            {templates.length ? "No template matches." : "No templates yet."}
          </Command.Empty>
          {templates.length > 0 && (
            <Command.Group heading="Templates" className={GROUP}>
              {recentFirst(templates).map((t) => (
                <Command.Item
                  key={t.id}
                  value={`${t.name} ${t.id}`}
                  keywords={[templateLine(t)]}
                  onSelect={() => onPick(t)}
                  className={item}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="truncate font-medium">{t.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-content/45">
                      {fieldCount(t)}
                    </span>
                  </span>
                  <span className="truncate text-xs text-content/45">{templateLine(t)}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          <Command.Group heading="More" className={GROUP}>
            {canSaveAs && (
              <Command.Item value="Save as template…" onSelect={onSaveAs} className={item}>
                Save as template…
              </Command.Item>
            )}
            <Command.Item
              value={templates.length ? "Manage templates…" : "New template…"}
              onSelect={() => {
                onClose();
                openTemplateSettings({ edit: templates.length ? null : "new" });
              }}
              className={item}
            >
              {templates.length ? "Manage templates…" : "New template…"}
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}

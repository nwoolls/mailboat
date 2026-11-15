import { useEffect, useRef, useState } from "react";
import { commands, type Label, type LabelSidebar } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { useLabelPalette } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import {
  CheckIcon,
  EyeIcon,
  type IconProps,
  LabelIcon,
  PaintIcon,
  TrashIcon,
} from "../../../shared/ui/icons";
import {
  Menu,
  type MenuAnchor,
  MenuItem,
  MenuSeparator,
  MenuSubmenu,
} from "../../../shared/ui/Menu";
import { labelTextColor } from "../model/labelColors";

/** Which label's menu is open, and where. */
export type LabelMenuTarget = { label: Label; anchor: MenuAnchor };

/**
 * A label's menu in the sidebar (right-click, or its ⋮ button): Rename…
 * (nested labels follow), its color, where it shows in the sidebar, whether
 * it shows on conversations, and Delete… (asks first; its conversations
 * stay, as in Gmail). The color and the sidebar choices are submenus.
 * Every change is saved to Gmail.
 */
export function LabelMenu({
  target,
  onClose,
  onDeleted,
}: {
  target: LabelMenuTarget | null;
  onClose: () => void;
  onDeleted: (label: Label) => void;
}) {
  const [renaming, setRenaming] = useState<Label | null>(null);
  const [deleting, setDeleting] = useState<Label | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (work: Promise<unknown>, done: () => void) => {
    setBusy(true);
    setError(null);
    work
      .then(done)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      {target && (
        <Menu anchor={target.anchor} onClose={onClose} label={`${target.label.name} menu`}>
          <MenuItem
            icon={LabelIcon}
            onSelect={() => {
              setError(null);
              setRenaming(target.label);
              onClose();
            }}
          >
            Rename…
          </MenuItem>
          <MenuSubmenu icon={PaintIcon} title="Color" label={`Color for ${target.label.name}`}>
            <ColorGrid
              label={target.label}
              onPick={(color) => {
                const label = target.label;
                onClose();
                change(commands.labelSetColor(label.id, color));
              }}
            />
          </MenuSubmenu>
          <MenuSubmenu
            icon={EyeIcon}
            title="Show in sidebar"
            label={`Where ${target.label.name} shows`}
          >
            {SIDEBAR_CHOICES.map(([value, title]) => (
              <MenuItem
                key={value}
                checkable="radio"
                checked={target.label.sidebar === value}
                icon={target.label.sidebar === value ? CheckIcon : NoIcon}
                onSelect={() => {
                  const label = target.label;
                  onClose();
                  change(commands.labelSetSidebar(label.id, value));
                }}
              >
                {title}
              </MenuItem>
            ))}
          </MenuSubmenu>
          <MenuItem
            checkable="checkbox"
            checked={target.label.onConversations}
            icon={target.label.onConversations ? CheckIcon : NoIcon}
            onSelect={() => {
              const label = target.label;
              onClose();
              change(commands.labelSetOnConversations(label.id, !label.onConversations));
            }}
          >
            Show on conversations
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={TrashIcon}
            danger
            onSelect={() => {
              setError(null);
              setDeleting(target.label);
              onClose();
            }}
          >
            Delete…
          </MenuItem>
        </Menu>
      )}
      {renaming && (
        <RenameDialog
          label={renaming}
          busy={busy}
          error={error}
          onSave={(name) =>
            run(unwrap(commands.labelRename(renaming.id, name)), () => setRenaming(null))
          }
          onCancel={() => setRenaming(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          confirmLabel="Delete"
          danger
          busy={busy}
          error={error ? `Couldn’t delete the label: ${error}` : null}
          onConfirm={() =>
            run(unwrap(commands.labelDelete(deleting.id)), () => {
              onDeleted(deleting);
              setDeleting(null);
            })
          }
          onCancel={() => setDeleting(null)}
        >
          <p>The label is removed from Gmail. Its conversations stay where they are.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** A small dialog with the label's name to edit; Return saves. */
function RenameDialog({
  label,
  busy,
  error,
  onSave,
  onCancel,
}: {
  label: Label;
  busy: boolean;
  error: string | null;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(label.name);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    // Opening focuses the dialog itself; put focus in the name, selected.
    field.current?.select();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="rename-label-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      className="dialog m-auto w-[22rem] rounded-xl p-5 text-[13px] text-content"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name);
        }}
      >
        <h2 id="rename-label-title" className="mb-3 text-sm font-semibold">
          Rename label
        </h2>
        <input
          ref={field}
          aria-label="Label name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 w-full rounded-md bg-selection px-2 outline-none"
        />
        <p className="mt-2 text-xs text-content/50">Use “/” to nest it under another label.</p>
        {error && <p className="selectable mt-2 text-xs text-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-7 rounded-md bg-selection px-3 hover:bg-selection-strong disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="h-7 rounded-md bg-accent px-3 font-medium text-white hover:brightness-110 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Rename"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Gmail's three places for a label in the label list, in its words. */
const SIDEBAR_CHOICES: [LabelSidebar, string][] = [
  ["show", "Always"],
  ["showIfUnread", "Only with unread mail"],
  ["hide", "Hidden"],
];

/** An empty icon, so unchecked choices line up with the checked one. */
function NoIcon(props: IconProps) {
  return <span className={props.className} style={{ width: props.size, height: props.size }} />;
}

/** Saves a change to a label; it shows once Gmail has it, or says why not. */
function change(work: Promise<{ status: "ok" } | { status: "error"; error: { message: string } }>) {
  void work.then((r) => {
    if (r.status === "error")
      showToast({ message: `Couldn’t change the label: ${r.error.message}` });
  });
}

/**
 * Gmail's label colors as a grid of swatches (its picker's 8 × 8), plus No
 * color, with a preview of the label as it will look.
 */
function ColorGrid({ label, onPick }: { label: Label; onPick: (color: string | null) => void }) {
  const palette = useLabelPalette().data ?? [];
  const [hovered, setHovered] = useState<string | null>(null);
  const preview = hovered ?? label.colorBg;
  return (
    <>
      <div className="grid grid-cols-8 gap-1 p-1.5">
        {palette.map((color) => (
          <button
            key={color}
            type="button"
            role="menuitem"
            aria-label={`Color ${color}`}
            aria-current={label.colorBg === color ? "true" : undefined}
            onClick={() => onPick(color)}
            onPointerEnter={() => setHovered(color)}
            onPointerLeave={() => setHovered(null)}
            onFocus={() => setHovered(color)}
            className={`h-5 w-5 rounded border border-black/10 outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              label.colorBg === color ? "ring-2 ring-accent ring-offset-1" : ""
            }`}
            style={{ background: color }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 px-1.5 pb-1">
        <button
          type="button"
          role="menuitem"
          onClick={() => onPick(null)}
          className="rounded px-1 text-xs text-content/70 outline-none hover:text-content focus:bg-selection-strong"
        >
          No color
        </button>
        <span
          className="truncate rounded px-1.5 text-xs"
          style={
            preview
              ? { background: preview, color: labelTextColor(preview) }
              : { background: "var(--color-selection)" }
          }
        >
          {label.name}
        </span>
      </div>
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { commands, type Label } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { LabelIcon, TrashIcon } from "../../../shared/ui/icons";
import { Menu, type MenuAnchor, MenuItem } from "../../../shared/ui/Menu";

/** Which label's menu is open, and where. */
export type LabelMenuTarget = { label: Label; anchor: MenuAnchor };

/**
 * A label's right-click menu in the sidebar: Rename… (nested labels
 * follow) and Delete… (asks first; its conversations stay, as in Gmail).
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

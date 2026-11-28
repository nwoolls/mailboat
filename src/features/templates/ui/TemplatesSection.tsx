import { useMemo, useState } from "react";
import type { Template } from "../../../platform/tauri/bindings";
import { useTemplateAction, useTemplates } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { CopyIcon, MoreIcon, TrashIcon } from "../../../shared/ui/icons";
import { anchorBelow, Menu, type MenuAnchor, MenuItem } from "../../../shared/ui/Menu";
import { Button } from "../../settings/ui/controls";
import { TemplateEditor } from "./TemplateEditor";
import { fieldCount, type TemplateSettingsTarget, templateLine } from "./TemplatePicker";

/**
 * Settings → Templates: every template, with a search, New template, and
 * Edit, Duplicate and Delete for each. They're kept on this computer and
 * shared by all accounts.
 */
export function TemplatesSection({
  target,
  onTargetSeen,
}: {
  /** A template to open in the editor on arrival (from the composer or ⌘K). */
  target: TemplateSettingsTarget;
  onTargetSeen: () => void;
}) {
  const query = useTemplates();
  const templates = useMemo(() => query.data ?? [], [query.data]);
  const action = useTemplateAction();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [menu, setMenu] = useState<{ at: MenuAnchor; template: Template } | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);

  // Arriving to edit one (from the composer or ⌘K): shown until closed.
  const wanted = target.edit;
  const arriving =
    wanted === "new"
      ? "new"
      : wanted === null
        ? null
        : (templates.find((t) => t.id === wanted) ?? null);
  const open = editing ?? arriving;
  const closeEditor = () => {
    setEditing(null);
    if (wanted !== null) onTargetSeen();
  };

  const needle = search.trim().toLowerCase();
  const shown = needle
    ? templates.filter((t) => `${t.name} ${templateLine(t)}`.toLowerCase().includes(needle))
    : templates;

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <input
          type="search"
          aria-label="Search templates"
          placeholder="Search templates"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-2 text-[13px] ring-1 ring-stroke outline-none placeholder:text-content/40 focus-visible:ring-2 focus-visible:ring-accent/70"
        />
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="h-7 shrink-0 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:brightness-110"
        >
          New template
        </button>
      </div>
      {templates.length === 0 && !query.isPending ? (
        <p className="rounded-lg px-4 py-6 text-center text-[13px] text-content/50 ring-1 ring-stroke">
          No templates yet. Make one here, or save a message you’re writing as one from its
          Templates button.
        </p>
      ) : (
        <ul className="rounded-lg ring-1 ring-stroke">
          {shown.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 border-b border-stroke px-4 py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{t.name}</div>
                <div className="truncate text-xs text-content/50">{templateLine(t) || "Empty"}</div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-content/45">
                  {[
                    t.from && `From ${t.from}`,
                    t.to.length + t.cc.length + t.bcc.length > 0 &&
                      ["To", t.cc.length && "Cc", t.bcc.length && "Bcc"].filter(Boolean).join(", "),
                    fieldCount(t),
                  ]
                    .filter(Boolean)
                    .map((tag) => (
                      <span key={String(tag)} className="rounded px-1.5 ring-1 ring-stroke">
                        {tag}
                      </span>
                    ))}
                </div>
              </div>
              <Button onClick={() => setEditing(t)} label={`Edit ${t.name}`}>
                Edit
              </Button>
              <button
                type="button"
                aria-label={`More for ${t.name}`}
                aria-haspopup="menu"
                onClick={(e) => setMenu({ at: anchorBelow(e.currentTarget), template: t })}
                className="flex h-7 w-7 items-center justify-center rounded-md text-content/60 hover:bg-selection hover:text-content"
              >
                <MoreIcon />
              </button>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="px-4 py-3 text-[13px] text-content/50">No template matches.</li>
          )}
        </ul>
      )}
      {menu && (
        <Menu
          anchor={{ ...menu.at, align: "end" }}
          label={menu.template.name}
          onClose={() => setMenu(null)}
        >
          <MenuItem
            icon={CopyIcon}
            onSelect={() => {
              const t = menu.template;
              setMenu(null);
              action.mutate(
                { id: t.id, action: "duplicate" },
                {
                  onError: (e) =>
                    showToast({ tone: "error", message: `Couldn’t duplicate: ${e.message}` }),
                },
              );
            }}
          >
            Duplicate
          </MenuItem>
          <MenuItem
            icon={TrashIcon}
            danger
            onSelect={() => {
              setDeleting(menu.template);
              setMenu(null);
            }}
          >
            Delete…
          </MenuItem>
        </Menu>
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          confirmLabel="Delete"
          danger
          busy={action.isPending}
          error={action.error?.message ?? null}
          onConfirm={() =>
            action.mutate(
              { id: deleting.id, action: "delete" },
              {
                onSuccess: () => {
                  setDeleting(null);
                  showToast({ message: "Template deleted" });
                },
              },
            )
          }
          onCancel={() => setDeleting(null)}
        >
          <p>Messages already written from it stay as they are.</p>
        </ConfirmDialog>
      )}
      {open && (
        <TemplateEditor
          key={open === "new" ? "new" : open.id}
          template={open === "new" ? null : open}
          onClose={closeEditor}
        />
      )}
    </>
  );
}

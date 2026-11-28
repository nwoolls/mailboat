import type { Command, CommandId } from "../features/commands/model/commands";
import type { Selection } from "../features/mailbox/model/views";
import type { Destination } from "../features/palette/model/destinations";
import type { PaletteItem } from "../features/palette/ui/CommandPalette";
import type { Template } from "../platform/tauri/bindings";
import { recentFirst } from "../features/templates/model/apply";
import { fieldCount } from "../features/templates/ui/TemplatePicker";
import { InboxIcon, LabelIcon, SettingsIcon, TemplateIcon } from "../shared/ui/icons";
import { commandIcon } from "./commandIcons";
import { accelLabel } from "../shared/lib/platform";

/** Where each command sits in the palette. */
const GROUPS: Partial<Record<CommandId, string>> = {
  new: "Mail",
  search: "Mail",
  sync: "Mail",
  sidebar: "View",
  reader: "View",
  shortcuts: "View",
  summarize: "AI",
  replyAi: "AI",
  translate: "AI",
};

/**
 * Everything the palette offers right now: the app's commands that can
 * run (the same list, names and keys as the menu bar and right-click
 * menu), the screensavers, Settings, and every view to go to. Each says
 * the key that does the same.
 */
export function paletteItems(p: {
  commands: Command[];
  run: (id: CommandId) => void;
  openSettings: () => void;
  /** The screensavers to offer: only while the list is empty, where they play. */
  screensavers: { id: string; label: string }[];
  /** Starts one by id, or the chosen one (Settings → Toybox) with null. */
  startScreensaver: (id: string | null) => void;
  destinations: Destination[];
  goTo: (s: Selection) => void;
  /** Each starts a new message from itself (none without an account). */
  templates: Template[];
  startFromTemplate: (t: Template) => void;
  manageTemplates: () => void;
}): PaletteItem[] {
  const items: PaletteItem[] = p.commands
    // The palette is open already, and views are listed below by name.
    .filter((c) => c.enabled && c.id !== "palette" && !c.id.startsWith("go:"))
    .map((c) => ({
      id: c.id,
      group: GROUPS[c.id] ?? "Conversation",
      title: c.title,
      shortcut: c.key,
      icon: commandIcon(c),
      run: () => p.run(c.id),
    }));
  if (p.screensavers.length) {
    items.push({
      id: "screensaver",
      group: "Screensaver",
      title: "Start screensaver",
      run: () => p.startScreensaver(null),
    });
    for (const s of p.screensavers)
      items.push({
        id: `screensaver:${s.id}`,
        group: "Screensaver",
        title: `Start screensaver: ${s.label}`,
        run: () => p.startScreensaver(s.id),
      });
  }
  // Typing the name, or "template", finds one; the most recently used first.
  for (const t of recentFirst(p.templates)) {
    const to = t.to[0];
    const people = to
      ? `To ${to.name || to.email}${t.to.length > 1 ? ` and ${t.to.length - 1} more` : ""}`
      : "";
    items.push({
      id: `template:${t.id}`,
      group: "New message from template",
      title: t.name,
      detail: [people, fieldCount(t)].filter(Boolean).join(" · ") || null,
      icon: TemplateIcon,
      run: () => p.startFromTemplate(t),
    });
  }
  items.push({
    id: "templates",
    group: "Mail",
    title: "Manage templates",
    icon: TemplateIcon,
    run: p.manageTemplates,
  });
  items.push({
    id: "settings",
    group: "View",
    title: "Settings",
    shortcut: accelLabel("Cmd+,"),
    icon: SettingsIcon,
    run: p.openSettings,
  });
  for (const d of p.destinations)
    items.push({
      id: `go:${d.key}`,
      group: "Go to",
      title: d.title,
      detail: d.detail,
      icon: d.selection.view.kind === "userLabel" ? LabelIcon : InboxIcon,
      run: () => p.goTo(d.selection),
    });
  return items;
}

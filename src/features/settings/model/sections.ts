/**
 * The Settings page's sections, in the order decided in the roadmap
 * (Milestone 5). Only sections with something in them are listed; the
 * others (Sidebar & List, Advanced)
 * join as their features arrive, in their place in that order.
 */
export type SettingsSectionId =
  | "general"
  | "accounts"
  | "notifications"
  | "appearance"
  | "viewing"
  | "composing"
  | "signatures"
  | "rules"
  | "vacation"
  | "keyboard"
  | "toybox";

export type SettingsSection = { id: SettingsSectionId; label: string; description: string };

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "general",
    label: "General",
    description: "Email links, and which version of Mailboat this is.",
  },
  {
    id: "accounts",
    label: "Accounts",
    description: "Your Gmail accounts: their colour, sign-in and addresses.",
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "New-mail alerts, and the unread count on the Dock.",
  },
  { id: "appearance", label: "Appearance", description: "How Mailboat looks." },
  {
    id: "viewing",
    label: "Viewing",
    description: "Reading, moving through conversations, and remote images.",
  },
  { id: "composing", label: "Composing", description: "Writing and sending mail." },
  {
    id: "signatures",
    label: "Signatures",
    description: "Added to new mail and replies from each address, here and in Gmail.",
  },
  {
    id: "rules",
    label: "Rules",
    description: "Gmail filters: what happens to mail as it arrives, even when Mailboat is closed.",
  },
  {
    id: "vacation",
    label: "Vacation responder",
    description: "Gmail's automatic reply while you're away, sent even when Mailboat is closed.",
  },
  { id: "keyboard", label: "Keyboard", description: "Every keyboard shortcut." },
  {
    id: "toybox",
    label: "Toybox",
    description: "Playful extras, just for fun.",
  },
];

export function sectionFor(id: SettingsSectionId): SettingsSection {
  return SETTINGS_SECTIONS.find((s) => s.id === id) ?? SETTINGS_SECTIONS[0]!;
}

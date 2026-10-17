/**
 * The Settings page's sections, in the order decided in the roadmap
 * (Milestone 5). Only sections with something in them are listed; the
 * others (Sidebar & List, Viewing, Composing, Signatures, Rules, Advanced)
 * join as their features arrive, in their place in that order.
 */
export type SettingsSectionId =
  | "general"
  | "accounts"
  | "notifications"
  | "appearance"
  | "keyboard";

export type SettingsSection = { id: SettingsSectionId; label: string; description: string };

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "general", label: "General", description: "About Mailboat." },
  {
    id: "accounts",
    label: "Accounts",
    description: "Your Gmail accounts: their colour, sign-in and addresses.",
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "When Mailboat tells you about new mail.",
  },
  { id: "appearance", label: "Appearance", description: "How Mailboat looks." },
  { id: "keyboard", label: "Keyboard", description: "Every keyboard shortcut." },
];

export function sectionFor(id: SettingsSectionId): SettingsSection {
  return SETTINGS_SECTIONS.find((s) => s.id === id) ?? SETTINGS_SECTIONS[0]!;
}

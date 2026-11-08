import { APP_NAME } from "../../../shared/lib/brand";
/**
 * The Settings page's sections, in the order decided in the roadmap
 * (Milestone 5). Only sections with something in them are listed. The
 * plan's "Sidebar & List" is "List" until the sidebar has settings.
 */
export type SettingsSectionId =
  | "general"
  | "accounts"
  | "notifications"
  | "appearance"
  | "list"
  | "viewing"
  | "composing"
  | "ai"
  | "signatures"
  | "rules"
  | "vacation"
  | "keyboard"
  | "toybox"
  | "advanced";

export type SettingsSection = { id: SettingsSectionId; label: string; description: string };

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "general",
    label: "General",
    description: `Email links, and which version of ${APP_NAME} this is.`,
  },
  {
    id: "accounts",
    label: "Accounts",
    description: "Your Gmail accounts: their color, sign-in and addresses.",
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "New-mail alerts, and the unread count on the Dock.",
  },
  { id: "appearance", label: "Appearance", description: `How ${APP_NAME} looks.` },
  {
    id: "list",
    label: "List",
    description: "The list of conversations: how rows look, and what swipes do.",
  },
  {
    id: "viewing",
    label: "Viewing",
    description: "Reading, moving through conversations, and remote images.",
  },
  { id: "composing", label: "Composing", description: "Writing and sending mail." },
  {
    id: "ai",
    label: "AI",
    description:
      "Summaries and help writing, with Apple Intelligence, ChatGPT or Claude, and AI apps that can read your mail.",
  },
  {
    id: "signatures",
    label: "Signatures",
    description: "Added to new mail and replies from each address, here and in Gmail.",
  },
  {
    id: "rules",
    label: "Rules",
    description: `Gmail filters: what happens to mail as it arrives, even when ${APP_NAME} is closed.`,
  },
  {
    id: "vacation",
    label: "Vacation responder",
    description: `Gmail's automatic reply while you're away, sent even when ${APP_NAME} is closed.`,
  },
  { id: "keyboard", label: "Keyboard", description: "Every keyboard shortcut." },
  {
    id: "toybox",
    label: "Toybox",
    description: "Playful extras, just for fun.",
  },
  {
    id: "advanced",
    label: "Advanced",
    description: "For when something goes wrong: the cache and the sync log.",
  },
];

export function sectionFor(id: SettingsSectionId): SettingsSection {
  return SETTINGS_SECTIONS.find((s) => s.id === id) ?? SETTINGS_SECTIONS[0]!;
}

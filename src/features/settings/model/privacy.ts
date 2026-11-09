import type { AiSettings, AppSettings_Serialize } from "../../../platform/tauri/bindings";
import type { SettingsSectionId } from "./sections";

/**
 * What Settings → Privacy lists: everything that leaves this computer, and
 * the setting that decides it, read from the real settings so the page can't
 * drift from what the app does. Read-only; each row names the section where
 * the choice is made.
 */
export type PrivacyRow = {
  id: "google" | "images" | "updates" | "cloudAi" | "aiApps";
  where: string;
  /** What it receives. */
  gets: string;
  /** When it happens. */
  when: string;
  /** The current choice, in words. */
  now: string;
  /** Where to change it, and the name of that section. */
  section: SettingsSectionId;
  sectionLabel: string;
};

/** Claude and ChatGPT run in the provider's cloud; Apple Intelligence runs on this Mac. */
export function isCloudProvider(provider: string | null | undefined): boolean {
  return provider === "claude" || provider === "chatgpt";
}

const NAMES: Record<string, string> = {
  apple: "Apple Intelligence",
  claude: "Claude",
  chatgpt: "ChatGPT",
};

function providerName(provider: string): string {
  return NAMES[provider] ?? provider;
}

/** The parts of AI that go to Claude or ChatGPT, one phrase each. Empty when none do. */
export function cloudUses(ai: AiSettings): string[] {
  const uses: string[] = [];
  if (isCloudProvider(ai.listSummaries)) {
    uses.push(`one-line summaries in the list (${providerName(ai.listSummaries ?? "")})`);
  }
  if (ai.readerSummary !== "off" && isCloudProvider(ai.readerProvider)) {
    const how = ai.readerSummary === "auto" ? "automatic" : "when you press Summarize";
    uses.push(
      `the summary above a conversation, ${how} (${providerName(ai.readerProvider ?? "")})`,
    );
  }
  if (isCloudProvider(ai.writingProvider)) {
    uses.push(`writing help (${providerName(ai.writingProvider ?? "")})`);
  }
  return uses;
}

export function leavesRows(settings: AppSettings_Serialize, accountCount: number): PrivacyRow[] {
  const imagesNow = {
    load: "Images load for everyone",
    correspondents: "Images load for people you've written to",
    block: "Images are blocked until you allow a sender",
  }[settings.remoteImages];
  const downloadedEarly = settings.imagePrefetch && settings.remoteImages !== "block";
  const uses = cloudUses(settings.ai);
  const readable = (settings.mcp.read ?? []).length;
  const drafts = (settings.mcp.drafts ?? []).length;

  return [
    {
      id: "google",
      where: "Google",
      gets: "Your mail, drafts, contacts and meeting invitations.",
      when: "Whenever it syncs, and when you act on mail.",
      now: "Always. It is your mail.",
      section: "accounts",
      sectionLabel: "Accounts",
    },
    {
      id: "images",
      where: "The sender's image host",
      gets: "A request for each remote image, which tells the sender the email arrived.",
      when: downloadedEarly
        ? "As mail arrives, so opening it makes no request. Never in Spam."
        : "When you open an email. Never in Spam.",
      now: imagesNow + (downloadedEarly ? ", and are downloaded on arrival." : "."),
      section: "viewing",
      sectionLabel: "Viewing",
    },
    {
      id: "updates",
      where: "The update server, then GitHub",
      gets: "One request for a small file. No mail, and not the app's version.",
      when: settings.autoCheckUpdates
        ? "At launch and about once a day."
        : "Only when you press Check for updates.",
      now:
        (settings.autoCheckUpdates ? "Checking automatically" : "Not checking automatically") +
        (settings.updateChannel === "beta" ? ", on the Beta channel." : "."),
      section: "general",
      sectionLabel: "General",
    },
    {
      id: "cloudAi",
      where: "Claude or ChatGPT",
      gets: "The text of the conversation, so the provider may keep it or train on it.",
      when: uses.length ? "Only for what is set to it." : "Never.",
      now: uses.length ? `Used for ${uses.join("; ")}.` : "Nothing is set to a cloud provider.",
      section: "ai",
      sectionLabel: "AI",
    },
    {
      id: "aiApps",
      where: "AI apps you allow",
      gets: "The mail they search and read, over a connection on this computer.",
      when: readable ? "When the app asks." : "Never.",
      now: readable
        ? `Can read ${readable} of ${accountCount} accounts, and save drafts for ${drafts}.`
        : "Off for every account.",
      section: "ai",
      sectionLabel: "AI",
    },
  ];
}

/** What never leaves the computer, for the second half of the page. */
export const STAYS_ON_THIS_COMPUTER: readonly string[] = [
  "Your mail cache, attachments and downloaded images.",
  "Sign-in tokens, kept in the system keychain and never in a file.",
  "Search, and the sign-in codes found in your mail.",
  "Summaries and writing help from Apple Intelligence.",
  "No account with us, no analytics and no crash reports.",
];

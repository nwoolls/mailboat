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

/**
 * Anything but Apple Intelligence (which runs on this Mac) is taken as a
 * provider's cloud, so a provider added later is disclosed until this learns it.
 */
export function isCloudProvider(provider: string | null | undefined): boolean {
  return provider != null && provider !== "apple";
}

const NAMES: Record<string, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
};

function providerName(provider: string | null | undefined): string {
  return NAMES[provider ?? ""] ?? provider ?? "";
}

/** The parts of AI that go to a cloud provider, one phrase each. Empty when none do. */
export function cloudUses(ai: AiSettings): string[] {
  const uses: string[] = [];
  if (isCloudProvider(ai.listSummaries)) {
    uses.push(`one-line summaries in the list (${providerName(ai.listSummaries)})`);
  }
  // Settings saved without the field get the default, which is automatic.
  const reader = ai.readerSummary ?? "auto";
  if (reader !== "off" && isCloudProvider(ai.readerProvider)) {
    const how = reader === "auto" ? "automatic" : "when you press Summarize";
    uses.push(`the summary above a conversation, ${how} (${providerName(ai.readerProvider)})`);
  }
  if (isCloudProvider(ai.writingProvider)) {
    uses.push(`writing help, and translation Apple can't do (${providerName(ai.writingProvider)})`);
  }
  return uses;
}

/**
 * `accountIds` are the accounts that exist now: AI apps count only those,
 * and drafts only for accounts they can also read, as the server does.
 */
export function leavesRows(
  settings: AppSettings_Serialize,
  accountIds: readonly number[],
): PrivacyRow[] {
  const prefetch = settings.imagePrefetch;
  const block = settings.remoteImages === "block";
  const imagesNow = {
    load: "Images load for everyone",
    correspondents: "Images load for people you've written to",
    block: "Images are blocked until you allow a sender",
  }[settings.remoteImages];
  let imagesWhen: string;
  if (block) {
    imagesWhen = prefetch
      ? "Only for senders you've allowed: as their recent mail arrives, and when you open older mail."
      : "Only when you open an email from a sender you've allowed.";
  } else {
    imagesWhen = prefetch
      ? "As recent mail arrives (the last two weeks), so opening it normally makes no request. Older mail, and an image that failed to download, load when you open the email."
      : "When you open an email.";
  }

  const uses = cloudUses(settings.ai);
  const exists = new Set(accountIds);
  const read = new Set((settings.mcp.read ?? []).filter((id) => exists.has(id)));
  const drafts = new Set((settings.mcp.drafts ?? []).filter((id) => read.has(id)));

  return [
    {
      id: "google",
      where: "Google",
      gets: "Your mail, drafts, contacts and meeting invitations, and your search words when a search goes past the mail stored here.",
      when: "Whenever it syncs, when you act on mail, and when a list or search reaches older mail.",
      now: "Always. It is your mail.",
      section: "accounts",
      sectionLabel: "Accounts",
    },
    {
      id: "images",
      where: "The sender's image host",
      gets: "A request for each remote image, which tells the sender the email arrived.",
      when: imagesWhen,
      now: `${imagesNow}. A choice you saved for a sender wins, except in Spam, which is always blocked. In Trash, only allowed senders load. Downloaded images are kept up to ${settings.imageCacheMb} MB, then the least recently shown are removed and load again when you open the email.`,
      section: "viewing",
      sectionLabel: "Viewing",
    },
    {
      id: "updates",
      where: "The update server, then GitHub",
      gets: "A request for a small file: no mail, and not the app's version. Installing an update also tells GitHub your kind of computer.",
      when: settings.autoCheckUpdates
        ? "At launch and about once a day, and when you press Check for updates or install."
        : "When you press Check for updates or install an update.",
      now:
        (settings.autoCheckUpdates ? "Checking automatically" : "Not checking automatically") +
        (settings.updateChannel === "beta" ? ", on the Beta channel." : "."),
      section: "general",
      sectionLabel: "General",
    },
    {
      id: "cloudAi",
      where: "Claude or ChatGPT",
      gets: "What it is asked about: a conversation to summarize, or the text, instructions and selection you give it, so the provider may keep it or train on it.",
      when: uses.length ? "Only for what is set to it." : "Never.",
      now: uses.length ? `Used for ${uses.join("; ")}.` : "Nothing is set to a cloud provider.",
      section: "ai",
      sectionLabel: "AI",
    },
    {
      id: "aiApps",
      where: "AI apps you allow",
      gets: "The mail they search and read, over a connection on this computer.",
      when: read.size ? "When the app asks." : "Never.",
      now: read.size
        ? `Can read ${read.size} of ${exists.size} accounts, and save drafts for ${drafts.size}.`
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
  "Searching the mail stored here, and finding the sign-in codes in it.",
  "Summaries and writing help from Apple Intelligence.",
  "Saved summaries stay until they are written again or cleared, or until you quit if you turn off Keep saved summaries.",
  "No account with us, no analytics and no crash reports.",
];

import type {
  AiProvider,
  AiSettings,
  AppSettings,
  ProviderStatus,
  Quality,
} from "../../../platform/tauri/bindings";

/** The AI settings with Rust's defaults filled in (Apple for everything). */
export type AiChoices = Required<AiSettings>;

export const AI_DEFAULTS: AiChoices = {
  connected: [],
  listSummaries: "apple",
  readerSummary: "auto",
  readerProvider: "apple",
  writingProvider: "apple",
  writingQuality: "best",
  chatgptModel: null,
};

export function aiChoices(settings: AppSettings | undefined): AiChoices {
  const ai = settings?.ai ?? {};
  return {
    connected: ai.connected ?? AI_DEFAULTS.connected,
    listSummaries: ai.listSummaries === undefined ? AI_DEFAULTS.listSummaries : ai.listSummaries,
    readerSummary: ai.readerSummary ?? AI_DEFAULTS.readerSummary,
    readerProvider: ai.readerProvider ?? AI_DEFAULTS.readerProvider,
    writingProvider: ai.writingProvider ?? AI_DEFAULTS.writingProvider,
    writingQuality: ai.writingQuality ?? AI_DEFAULTS.writingQuality,
    chatgptModel: ai.chatgptModel ?? AI_DEFAULTS.chatgptModel,
  };
}

/** Alphabetical by name, wherever providers are listed. */
export const PROVIDERS: AiProvider[] = ["apple", "chatgpt", "claude"];

export const PROVIDER_NAMES: Record<AiProvider, string> = {
  apple: "Apple Intelligence",
  claude: "Claude",
  chatgpt: "ChatGPT",
};

/** The program each one is reached through, for set-up help. */
export const PROVIDER_TOOLS: Record<AiProvider, { name: string; url: string } | null> = {
  apple: null,
  claude: { name: "Claude Code", url: "https://claude.com/product/claude-code" },
  chatgpt: { name: "Codex", url: "https://developers.openai.com/codex/cli" },
};

export function statusOf(
  statuses: ProviderStatus[] | undefined,
  provider: AiProvider,
): ProviderStatus | undefined {
  return statuses?.find((s) => s.provider === provider);
}

export function isReady(statuses: ProviderStatus[] | undefined, provider: AiProvider): boolean {
  return statusOf(statuses, provider)?.state === "ready";
}

/** Whether a provider can take a request: set up and connected (Apple needs no connecting). */
function usable(ai: AiChoices, statuses: ProviderStatus[] | undefined, provider: AiProvider) {
  return isReady(statuses, provider) && (provider === "apple" || ai.connected.includes(provider));
}

/** Whether an opened conversation can be summarized (Settings → AI, not turned off). */
export function canSummarize(ai: AiChoices, statuses: ProviderStatus[] | undefined): boolean {
  return ai.readerSummary !== "off" && usable(ai, statuses, ai.readerProvider);
}

/** Whether the writing assistant (Reply with AI) can be offered. */
export function canWrite(ai: AiChoices, statuses: ProviderStatus[] | undefined): boolean {
  return usable(ai, statuses, ai.writingProvider);
}

/**
 * The providers a feature can use: Apple Intelligence (built in), then
 * whichever of ChatGPT and Claude were connected.
 */
export function offered(ai: AiChoices): AiProvider[] {
  return PROVIDERS.filter((p) => p === "apple" || ai.connected.includes(p));
}

/** A provider row's status line in Settings → AI. */
export function statusLine(status: ProviderStatus | undefined, connected: boolean): string {
  if (!status) return "Checking…";
  switch (status.state) {
    case "ready":
      if (status.provider === "apple") return "Ready. Runs on this Mac: mail never leaves it.";
      if (!connected) return "Signed in, not used by Mailboat yet.";
      return status.account ? `Connected as ${status.account}.` : "Connected.";
    case "signedOut":
      return connected ? "Signed out. Connect again to sign in." : "Not connected.";
    case "notInstalled":
      return status.provider === "apple"
        ? "Needs macOS 26 or later."
        : `Needs ${PROVIDER_TOOLS[status.provider]?.name ?? "its app"}, which isn’t installed.`;
    case "unavailable":
      return status.reason;
  }
}

/** Whether Mailboat sends mail off the Mac when using it. */
export function leavesMac(provider: AiProvider): boolean {
  return provider !== "apple";
}

/**
 * Claude's writing model choice. ChatGPT picks a model from Codex's own
 * list instead (Settings → AI); Apple has one model: no choice.
 */
export function qualityChoices(provider: AiProvider): { value: Quality; label: string }[] | null {
  switch (provider) {
    case "claude":
      return [
        { value: "fast", label: "Haiku" },
        { value: "best", label: "Sonnet" },
        { value: "strongest", label: "Opus" },
      ];
    case "chatgpt":
    case "apple":
      return null;
  }
}

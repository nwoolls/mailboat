import { useState } from "react";
import {
  commands,
  type AiProvider,
  type AppSettings,
  type ReaderSummary,
} from "../../../platform/tauri/bindings";
import { IpcError, unwrap } from "../../../platform/tauri/ipc";
import {
  useAiConnect,
  useAiDisconnect,
  useAiStatus,
  useAiUsage,
  useChatgptModels,
  useAppSettings,
  useSaveAppSettings,
} from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import { Button, Group, Row, Segmented } from "../../settings/ui/controls";
import {
  type AiChoices,
  aiChoices,
  appleSupported,
  leavesMac,
  offered,
  PROVIDER_NAMES,
  PROVIDER_TOOLS,
  PROVIDERS,
  qualityChoices,
  statusLine,
  statusOf,
} from "../model/providers";
import { describeLimit, describeTotals, startOfToday } from "../model/usage";
import { AiAppsGroups } from "../../mcp/ui/AiAppsGroups";
import { clearLineSummaries } from "./lineSummaries";
import { accelLabel } from "../../../shared/lib/platform";
import { APP_NAME } from "../../../shared/lib/brand";

const SELECT_CLASS =
  "h-7 max-w-64 rounded-md border border-content/10 bg-transparent px-1.5 text-[12px] text-content/80 hover:bg-selection";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Settings → AI: the providers (Apple Intelligence built in; Claude and
 * ChatGPT connected by signing in through their own apps), what each
 * feature uses, and how much each has been asked.
 */
export function AiSection() {
  const settings = useAppSettings().data;
  const save = useSaveAppSettings();
  const ai = aiChoices(settings);
  const update = (change: Partial<AiChoices>) =>
    settings &&
    save.mutate({ ...settings, ai: { ...ai, ...change } } satisfies AppSettings, {
      onError: (e) => showToast({ tone: "error", message: `Couldn’t save: ${errorText(e)}` }),
    });
  const statuses = useAiStatus().data;
  const choices = offered(ai, statuses);
  // Windows, or a Mac that can't run it: not offered anywhere.
  const apple = appleSupported(statuses);
  return (
    <>
      <Group
        title="Providers"
        description={`${apple ? "Apple Intelligence runs on this Mac. " : ""}ChatGPT and Claude use your own subscription: connecting signs in through their apps in the browser, with no API key.`}
      >
        {PROVIDERS.filter((p) => p !== "apple" || apple).map((p) => (
          <ProviderRow key={p} provider={p} connected={p === "apple" || ai.connected.includes(p)} />
        ))}
      </Group>
      <Group title="Summaries">
        <Row
          label="In the list"
          description={
            <>
              A one-line summary in place of each conversation’s first words, written as rows come
              into view. Hover one to see the email’s own words.
              {ai.listSummaries && leavesMac(ai.listSummaries) && (
                <span className="text-warn">
                  {" "}
                  Every conversation you scroll past is sent to {PROVIDER_NAMES[ai.listSummaries]}.
                </span>
              )}
            </>
          }
        >
          <ProviderSelect
            label="Summaries in the list"
            value={ai.listSummaries}
            options={choices}
            allowOff
            disabled={!settings}
            onChange={(listSummaries) => {
              clearLineSummaries();
              update({ listSummaries });
            }}
          />
        </Row>
        <Row
          label="Above a conversation"
          description="A few points above the messages. Automatically: for conversations long enough to need one. With a button: only when you ask."
        >
          <Segmented
            label="Summary above a conversation"
            value={ai.readerSummary}
            options={READER_SUMMARY}
            disabled={!settings}
            onChange={(readerSummary) => update({ readerSummary })}
          />
        </Row>
        {ai.readerSummary !== "off" && (
          <Row
            label="Summarize with"
            description={
              ai.readerProvider === "apple" && !apple
                ? "Choose a provider to have conversations summarized."
                : leavesMac(ai.readerProvider)
                  ? `Conversations you open are sent to ${PROVIDER_NAMES[ai.readerProvider]}${
                      ai.readerSummary === "auto" ? " automatically" : " when you ask"
                    }.`
                  : "Stays on this Mac."
            }
          >
            <ProviderSelect
              label="Summarize with"
              value={ai.readerProvider}
              options={choices}
              disabled={!settings}
              onChange={(p) => p && update({ readerProvider: p })}
            />
          </Row>
        )}
        <Row
          label="Saved summaries"
          description="Summaries are kept until new mail arrives in the conversation. Clear them to have them written again."
        >
          <Button
            onClick={() =>
              void unwrap(commands.aiSummariesClear())
                .then(() => {
                  clearLineSummaries();
                  showToast({ message: "Summaries cleared" });
                })
                .catch((e: unknown) =>
                  showToast({ tone: "error", message: `Couldn’t clear: ${errorText(e)}` }),
                )
            }
          >
            Clear
          </Button>
        </Row>
      </Group>
      <Group title="Writing">
        <Row
          label="Help writing with"
          description={
            <>
              In a reply or new message, {accelLabel("Cmd+J")} (or the ✦ button) opens a chat beside
              it: ask for a draft, refine it, then Insert or Replace. It reads the conversation
              you’re answering. Nothing is sent until you ask.
              {leavesMac(ai.writingProvider) &&
                ` Your request and the conversation go to ${PROVIDER_NAMES[ai.writingProvider]}.`}
            </>
          }
        >
          <ProviderSelect
            label="Help writing with"
            value={ai.writingProvider}
            options={choices}
            disabled={!settings}
            onChange={(p) => p && update({ writingProvider: p })}
          />
        </Row>
        {qualityChoices(ai.writingProvider) && (
          <Row
            label="Model"
            description="Haiku is quickest, Opus writes best but uses more of your plan. Summaries and suggestions always use Haiku."
          >
            <Segmented
              label="Model"
              value={ai.writingQuality}
              options={qualityChoices(ai.writingProvider) ?? []}
              disabled={!settings}
              onChange={(writingQuality) => update({ writingQuality })}
            />
          </Row>
        )}
        {ai.writingProvider === "chatgpt" && (
          <ChatgptModelRow
            value={ai.chatgptModel}
            disabled={!settings}
            onChange={(chatgptModel) => update({ chatgptModel })}
          />
        )}
      </Group>
      <AiAppsGroups />
      <UsageGroup />
    </>
  );
}

/**
 * ChatGPT's writing model, from Codex's own list. Summaries and the chips
 * always use the list's fast model, whatever is chosen here.
 */
function ChatgptModelRow({
  value,
  disabled,
  onChange,
}: {
  value: string | null;
  disabled: boolean;
  onChange: (model: string | null) => void;
}) {
  const models = useChatgptModels(true).data ?? [];
  // One chosen before Codex dropped it still shows as chosen.
  const listed = value && !models.some((m) => m.slug === value);
  return (
    <Row
      label="Model"
      description={`${
        models.find((m) => m.slug === value)?.description ??
        "Whichever model Codex uses by default."
      } Summaries and suggestions always use Codex’s fast model.`}
    >
      <select
        aria-label="ChatGPT model"
        value={value ?? "default"}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "default" ? null : e.target.value)}
        className={SELECT_CLASS}
      >
        <option value="default">Codex’s default</option>
        {models.map((m) => (
          <option key={m.slug} value={m.slug}>
            {m.name}
          </option>
        ))}
        {listed && <option value={value}>{value}</option>}
      </select>
    </Row>
  );
}

const READER_SUMMARY: { value: ReaderSummary; label: string }[] = [
  { value: "auto", label: "Automatically" },
  { value: "button", label: "With a button" },
  { value: "off", label: "Off" },
];

function ProviderSelect({
  label,
  value,
  options,
  allowOff,
  disabled,
  onChange,
}: {
  label: string;
  value: AiProvider | null;
  options: AiProvider[];
  allowOff?: boolean;
  disabled?: boolean;
  onChange: (p: AiProvider | null) => void;
}) {
  // Apple Intelligence where it can't run (Windows) counts as not chosen.
  const unchosen = value === "apple" && !options.includes("apple");
  // A provider chosen before it was disconnected still shows as chosen.
  const shown = value && !unchosen && !options.includes(value) ? [...options, value] : options;
  const current = unchosen ? (allowOff ? "off" : "") : (value ?? "off");
  return (
    <select
      aria-label={label}
      value={current}
      disabled={disabled || shown.length === 0}
      onChange={(e) => onChange(e.target.value === "off" ? null : (e.target.value as AiProvider))}
      className={SELECT_CLASS}
    >
      {allowOff && <option value="off">Off</option>}
      {current === "" && (
        <option value="" disabled>
          {shown.length === 0 ? "Connect one above" : "Choose…"}
        </option>
      )}
      {shown.map((p) => (
        <option key={p} value={p}>
          {PROVIDER_NAMES[p]}
        </option>
      ))}
    </select>
  );
}

function ProviderRow({ provider, connected }: { provider: AiProvider; connected: boolean }) {
  const statuses = useAiStatus();
  const status = statusOf(statuses.data, provider);
  const connect = useAiConnect();
  const disconnect = useAiDisconnect();
  const [waiting, setWaiting] = useState(false);
  const tool = PROVIDER_TOOLS[provider];
  const ready = status?.state === "ready";

  let control: React.ReactNode = null;
  if (provider === "apple") {
    if (status?.state === "unavailable")
      control = (
        <Button
          onClick={() =>
            void unwrap(commands.aiAppleSettingsOpen()).catch((e: unknown) =>
              showToast({ tone: "error", message: errorText(e) }),
            )
          }
        >
          Open System Settings
        </Button>
      );
  } else if (status?.state === "notInstalled" && tool) {
    control = (
      <Button
        onClick={() =>
          void unwrap(commands.linkOpen(tool.url)).catch((e: unknown) =>
            showToast({ tone: "error", message: errorText(e) }),
          )
        }
      >
        Get {tool.app.replace(/^the /, "")}
      </Button>
    );
  } else if (waiting) {
    control = (
      <div className="flex items-center gap-2">
        <span className="text-xs text-content/50">Finish signing in in your browser…</span>
        <Button onClick={() => void commands.aiConnectCancel()}>Cancel</Button>
      </div>
    );
  } else if (connected && ready) {
    control = (
      <Button
        onClick={() =>
          disconnect.mutate(provider, {
            onError: (e) => showToast({ tone: "error", message: errorText(e) }),
          })
        }
      >
        Disconnect
      </Button>
    );
  } else if (status) {
    control = (
      <Button
        disabled={connect.isPending}
        onClick={() => {
          setWaiting(status.state === "signedOut");
          connect.mutate(provider, {
            onSettled: () => setWaiting(false),
            onSuccess: () => showToast({ message: `${PROVIDER_NAMES[provider]} connected` }),
            onError: (e) => {
              if (e instanceof IpcError && e.kind === "cancelled") return;
              showToast({ tone: "error", message: errorText(e) });
            },
          });
        }}
      >
        {connected ? "Sign in" : "Connect"}
      </Button>
    );
  }

  return (
    <Row
      label={PROVIDER_NAMES[provider]}
      description={
        <>
          {statusLine(status, connected)}
          {tool && !ready && status?.state !== "notInstalled" && (
            <>
              {" "}
              Uses your {PROVIDER_NAMES[provider]} plan through {tool.name}.
            </>
          )}
        </>
      }
    >
      {control}
    </Row>
  );
}

function UsageGroup() {
  const usage = useAiUsage(startOfToday()).data;
  const used = usage?.providers.filter((p) => p.last30Days.requests > 0 || p.today.requests > 0);
  return (
    <Group
      title="Usage"
      description={`Requests made from ${APP_NAME}, and the tokens and cost they reported (Claude reports an API-price estimate; a subscription isn’t billed it). What was sent is never recorded.`}
    >
      {!used || used.length === 0 ? (
        <Row label="Nothing yet" description="Summaries and writing help will show here." />
      ) : (
        used.map((p) => (
          <Row
            key={p.provider}
            label={PROVIDER_NAMES[p.provider]}
            description={
              <>
                Today: {describeTotals(p.today, p.provider === "apple")}
                <br />
                Last 30 days: {describeTotals(p.last30Days, p.provider === "apple")}
                {p.provider === "claude" &&
                  usage?.limits.map((l) => (
                    <span key={l.window}>
                      <br />
                      Plan: {describeLimit(l)}
                    </span>
                  ))}
              </>
            }
          />
        ))
      )}
    </Group>
  );
}

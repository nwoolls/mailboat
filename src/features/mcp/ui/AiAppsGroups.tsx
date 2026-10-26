import { commands, type AppSettings } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import {
  useAccounts,
  useAppSettings,
  useMcpConnect,
  useMcpLog,
  useMcpSetup,
  useSaveAppSettings,
} from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import { AccountDot } from "../../../shared/ui/AccountDot";
import { formatListDate } from "../../mailbox/model/format";
import { Button, Group, Row, Toggle } from "../../settings/ui/controls";
import { clientName, describeRequest, mcpAccess, setAccess } from "../model/access";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Settings → AI → AI apps: which accounts Claude Desktop, Claude Code and
 * other MCP apps may read (and draft in), connecting them, and what they
 * asked for. Nothing is shared until an account is turned on here.
 */
export function AiAppsGroups() {
  const settings = useAppSettings().data;
  const save = useSaveAppSettings();
  const accounts = useAccounts().data ?? [];
  const access = mcpAccess(settings?.mcp);
  const setup = useMcpSetup().data;
  const connect = useMcpConnect();
  const log = useMcpLog().data ?? [];

  const change = (next: typeof access) =>
    settings &&
    save.mutate({ ...settings, mcp: next } satisfies AppSettings, {
      onError: (e) => showToast({ tone: "error", message: `Couldn’t save: ${errorText(e)}` }),
    });
  const connectApp = (app: "code" | "desktop") =>
    connect.mutate(app, {
      onSuccess: () =>
        showToast({
          message:
            app === "code"
              ? "Claude Code can use Mailboat now (in new sessions)."
              : "Added to Claude Desktop. Quit and reopen Claude to see Mailboat.",
        }),
      onError: (e) => showToast({ tone: "error", message: errorText(e) }),
    });
  const emailOf = (id: number | null) => accounts.find((a) => a.id === id)?.email;

  return (
    <>
      <Group
        title="AI apps"
        description="Let Claude Desktop, Claude Code or another MCP app search and read your mail through Mailboat, while Mailboat is open. Off for every account until you turn it on. Spam and Trash are never shared, and nothing is ever sent: drafts wait in Drafts for you."
      >
        {accounts.map((a) => (
          <Row
            key={a.id}
            label={
              <span className="flex items-center gap-2">
                <AccountDot account={a} />
                {a.email}
              </span>
            }
            description={
              access.read.includes(a.id)
                ? "Its mail is sent to the AI app (and its AI provider) when it asks."
                : undefined
            }
          >
            <span className="text-[12px] text-content/55">Read mail</span>
            <Toggle
              label={`AI apps can read ${a.email}`}
              on={access.read.includes(a.id)}
              disabled={!settings}
              onChange={(on) => change(setAccess(access, a.id, "read", on))}
            />
            <span className="ml-2 text-[12px] text-content/55">Create drafts</span>
            <Toggle
              label={`AI apps can save drafts in ${a.email}`}
              on={access.drafts.includes(a.id)}
              disabled={!settings}
              onChange={(on) => change(setAccess(access, a.id, "drafts", on))}
            />
          </Row>
        ))}
        <Row
          label="Claude Code"
          description={
            setup?.claudeCodeConnected
              ? "Connected: new Claude Code sessions can use Mailboat."
              : setup?.claudeCodeInstalled === false
                ? "Not installed."
                : "Adds Mailboat to Claude Code for every project."
          }
        >
          {setup?.claudeCodeInstalled && (
            <Button disabled={connect.isPending} onClick={() => connectApp("code")}>
              {setup.claudeCodeConnected ? "Connect again" : "Connect"}
            </Button>
          )}
        </Row>
        <Row
          label="Claude Desktop"
          description={
            setup?.claudeDesktopConnected
              ? "Connected. If Mailboat’s tools don’t show, quit and reopen Claude."
              : "Adds Mailboat to Claude Desktop’s settings (a copy of the old file is kept)."
          }
        >
          <Button disabled={connect.isPending} onClick={() => connectApp("desktop")}>
            {setup?.claudeDesktopConnected ? "Connect again" : "Connect"}
          </Button>
        </Row>
        {setup && (
          <Row
            label="Other apps"
            description={
              <>
                Add an MCP server that runs this command:
                <br />
                <code className="selectable text-content/70">{setup.program} --mcp</code>
              </>
            }
          >
            <Button
              onClick={() =>
                void unwrap(commands.textCopy(`${setup.program} --mcp`)).then(
                  () => showToast({ message: "Copied" }),
                  (e: unknown) => showToast({ tone: "error", message: errorText(e) }),
                )
              }
            >
              Copy
            </Button>
          </Row>
        )}
      </Group>
      <Group
        title="What AI apps asked for"
        description="The last 30 days: what was searched and read, never the emails themselves."
      >
        {log.length === 0 ? (
          <Row label="Nothing yet" description="Requests from AI apps will show here." />
        ) : (
          log.map((e) => (
            <Row
              key={e.id}
              label={describeRequest(e)}
              description={[clientName(e.client), emailOf(e.accountId), formatListDate(e.at)]
                .filter(Boolean)
                .join(" · ")}
            />
          ))
        )}
      </Group>
    </>
  );
}

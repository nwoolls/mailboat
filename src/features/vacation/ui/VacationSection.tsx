import { useState } from "react";
import type { Account, AccountVacation, VacationSettings } from "../../../platform/tauri/bindings";
import { useSaveVacation, useVacations } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import { AccountAvatar } from "../../accounts/ui/AccountAvatar";
import { useSignIn } from "../../accounts/ui/useSignIn";
import { EditorBody, FormatBar, useRichEditor } from "../../compose/ui/RichEditor";
import { Button, Group, Row, Toggle } from "../../settings/ui/controls";
import {
  formFromSettings,
  toSettings,
  type VacationForm,
  vacationProblem,
  vacationStatus,
} from "../model/vacationForm";
import { APP_NAME } from "../../../shared/lib/brand";

/**
 * Settings → Vacation responder: Gmail's automatic reply, per account.
 * Gmail sends the replies (once per sender every few days), whether or
 * not the app is open.
 */
export function VacationSection({ accounts }: { accounts: Account[] }) {
  const vacations = useVacations();
  const signIn = useSignIn();
  return (
    <>
      {vacations.error && (
        <p className="selectable pb-4 text-[12px] text-danger">{vacations.error.message}</p>
      )}
      {signIn.error && <p className="selectable pb-4 text-[12px] text-danger">{signIn.error}</p>}
      {accounts.map((account) => {
        const listed = vacations.data?.find((v) => v.accountId === account.id);
        const name = account.displayName?.trim();
        return (
          <Group
            key={account.id}
            title={
              <>
                <AccountAvatar account={account} state={undefined} />
                <span className="truncate">{name || account.email}</span>
                {name && (
                  <span className="truncate font-normal text-content/45">{account.email}</span>
                )}
              </>
            }
          >
            {!listed ? (
              <Row label="Loading…" />
            ) : listed.state.kind === "needsSignIn" ? (
              <Row
                label="Sign in again"
                description={
                  <span className="text-warn">
                    {APP_NAME} needs permission to see and change this account’s vacation responder.
                  </span>
                }
              >
                <Button onClick={() => signIn.start(account.email)} disabled={signIn.pending}>
                  Sign in again
                </Button>
              </Row>
            ) : listed.state.kind === "unavailable" ? (
              <Row
                label="Couldn’t load the vacation responder"
                description={<span className="selectable text-danger">{listed.state.message}</span>}
              />
            ) : (
              // Keyed by what Gmail has, so a save (here or elsewhere) starts afresh.
              <VacationEditor
                key={JSON.stringify(listed.state.settings)}
                account={listed}
                settings={listed.state.settings}
                canLimitToDomain={listed.state.canLimitToDomain}
              />
            )}
          </Group>
        );
      })}
    </>
  );
}

function VacationEditor({
  account,
  settings,
  canLimitToDomain,
}: {
  account: AccountVacation;
  settings: VacationSettings;
  canLimitToDomain: boolean;
}) {
  // When this was opened: enough for "today" and "on until…".
  const [now] = useState(() => Date.now());
  const [original] = useState(() => formFromSettings(settings, now));
  const [form, setForm] = useState<VacationForm>(original);
  const set = <K extends keyof VacationForm>(key: K, value: VacationForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const editor = useRichEditor(settings.bodyHtml, (c) => {
    if (c.edited) setForm((f) => ({ ...f, bodyHtml: c.html, bodyText: c.text }));
  });
  const save = useSaveVacation();
  const problem = vacationProblem(form);
  const changed = JSON.stringify(form) !== JSON.stringify(original);

  const submit = (next: VacationForm) =>
    save.mutate(
      { account: account.accountId, settings: toSettings(next) },
      {
        onSuccess: (saved) => {
          const s = saved.state.kind === "ready" ? saved.state.settings : null;
          showToast({
            message: s ? `Vacation responder: ${vacationStatus(s, Date.now())}` : "Saved",
          });
        },
      },
    );

  const field =
    "h-7 rounded-md bg-selection-subtle px-2 text-[12px] outline-none focus:bg-selection";
  return (
    <>
      <Row label="Vacation responder" description={vacationStatus(settings, now)}>
        <Toggle
          label="Vacation responder"
          on={form.enabled}
          onChange={(on) => set("enabled", on)}
        />
      </Row>
      <Row label="First day">
        <input
          type="date"
          aria-label="First day"
          value={form.firstDay}
          onChange={(e) => set("firstDay", e.target.value)}
          className={field}
        />
      </Row>
      <Row label="Last day" description="Leave it off to reply until you turn it off.">
        <label className="flex items-center gap-2 text-[12px] text-content/70">
          <input
            type="checkbox"
            checked={form.lastDay !== ""}
            onChange={(e) => set("lastDay", e.target.checked ? form.firstDay : "")}
            className="size-3.5 accent-accent"
          />
          Last day
        </label>
        {form.lastDay !== "" && (
          <input
            type="date"
            aria-label="Last day"
            value={form.lastDay}
            min={form.firstDay}
            onChange={(e) => set("lastDay", e.target.value)}
            className={field}
          />
        )}
      </Row>
      <div className="border-b border-content/5 px-4 py-3.5">
        <input
          aria-label="Subject"
          placeholder="Subject"
          value={form.subject}
          onChange={(e) => set("subject", e.target.value)}
          className={`${field} mb-2 w-full`}
        />
        <div className="rounded-lg ring-1 ring-stroke">
          <div className="border-b border-stroke py-1">
            <FormatBar editor={editor} />
          </div>
          <div className="max-h-64 min-h-24 overflow-y-auto px-3">
            <EditorBody editor={editor} />
          </div>
        </div>
      </div>
      <Row label="Only reply to people in my contacts">
        <Toggle
          label="Only reply to people in my contacts"
          on={form.contactsOnly}
          onChange={(on) => set("contactsOnly", on)}
        />
      </Row>
      {canLimitToDomain && (
        <Row label="Only reply to people in my organization">
          <Toggle
            label="Only reply to people in my organization"
            on={form.domainOnly}
            onChange={(on) => set("domainOnly", on)}
          />
        </Row>
      )}
      <div className="flex items-center gap-2 px-4 py-3">
        <p className="min-w-0 flex-1 text-[12px]">
          {save.error ? (
            <span className="selectable text-danger">{save.error.message}</span>
          ) : (
            changed && problem && <span className="text-content/50">{problem}</span>
          )}
        </p>
        {changed && (
          <Button
            onClick={() => {
              setForm(original);
              editor?.commands.setContent(settings.bodyHtml, { emitUpdate: false });
            }}
            disabled={save.isPending}
          >
            Discard changes
          </Button>
        )}
        <Button
          onClick={() => submit(form)}
          disabled={!changed || problem !== null || save.isPending}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </>
  );
}

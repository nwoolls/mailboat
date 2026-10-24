import { useEffect, useRef, useState } from "react";
import type {
  Account,
  AccountId,
  Category,
  Importance,
  Label,
  Rule,
  RuleCriteria,
  SizeComparison,
} from "../../../platform/tauri/bindings";
import { commands } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { useLabels, useRuleMatchCount, useSaveRule } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import { AccountDot } from "../../../shared/ui/AccountDot";
import { ClearIcon } from "../../../shared/ui/icons";
import type { MenuAnchor } from "../../../shared/ui/Menu";
import { LabelPicker } from "../../mailbox/ui/LabelPicker";
import { pickerName } from "../../mailbox/model/labelPicker";
import {
  emptyForm,
  formFromRule,
  formProblem,
  labelsForAccount,
  hasCriteria,
  type RuleForm,
  type SizeUnit,
  toActions,
  toCriteria,
} from "../model/ruleForm";
import { applyText, CATEGORY_NAMES, matchText, savedMessage } from "../model/summary";

/** What the editor opens on: a new rule (maybe filled in from mail) or one to change. */
export type RuleEditorTarget =
  | {
      kind: "new";
      accountId: AccountId;
      criteria?: Partial<RuleCriteria>;
      /** Opened from mail ("Filter messages like these"): the account is fixed. */
      fromMail?: boolean;
    }
  | { kind: "edit"; rule: Rule }
  /** A new rule starting as a copy of this one, for any account. */
  | { kind: "copy"; rule: Rule };

/** Waits for typing to pause before passing a value on. */
function useSettled(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

const field =
  "h-7 min-w-0 rounded-md bg-selection-subtle px-2 outline-none placeholder:text-content/35 focus:bg-selection";

/**
 * Creates or changes a rule (a Gmail filter), in one dialog laid out like
 * Gmail's filter form: which mail, then what to do with it. While you type,
 * it says how many conversations match now. ⌘↩ saves; Esc cancels.
 */
export function RuleEditor({
  target,
  accounts,
  onClose,
}: {
  target: RuleEditorTarget;
  accounts: Account[];
  onClose: () => void;
}) {
  const editing = target.kind === "edit";
  const [accountId, setAccountId] = useState<AccountId>(
    target.kind === "new" ? target.accountId : target.rule.accountId,
  );
  const [form, setForm] = useState<RuleForm>(() =>
    target.kind === "new" ? emptyForm(target.criteria) : formFromRule(target.rule),
  );
  const set = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const account = accounts.find((a) => a.id === accountId);
  const labels = useLabels({ kind: "only", ids: [accountId] }).data ?? [];
  const allLabels = useLabels({ kind: "all" }).data ?? [];
  const userLabels = labels.filter((l) => l.kind === "user");
  const [labelAnchor, setLabelAnchor] = useState<MenuAnchor | null>(null);

  const criteria = toCriteria(form);
  // Counted once typing pauses, not on every keystroke.
  const settledCriteria = JSON.parse(useSettled(JSON.stringify(criteria), 400)) as RuleCriteria;
  const counting = hasCriteria(settledCriteria);
  const matches = useRuleMatchCount(accountId, counting ? settledCriteria : null);
  const count = counting ? (matches.data ?? null) : null;
  const save = useSaveRule();
  const problem = formProblem(form);

  const ref = useRef<HTMLDialogElement>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    // Opening focuses the dialog itself; start in From instead.
    first.current?.focus();
    return () => el?.close();
  }, []);

  const submit = () => {
    if (problem || save.isPending) return;
    save.mutate(
      {
        accountId,
        filterId: target.kind === "edit" ? target.rule.filterId : null,
        criteria,
        actions: toActions(form),
        applyToExisting: form.applyToExisting,
      },
      {
        onSuccess: (saved) => {
          onClose();
          if (saved.applyError)
            showToast({
              tone: "error",
              message: `Rule saved, but applying it to existing mail failed: ${saved.applyError}`,
            });
          else showToast({ message: savedMessage(editing, saved.applied) });
        },
      },
    );
  };

  const toggleLabel = (label: Label) =>
    set(
      "labels",
      form.labels.includes(label.id)
        ? form.labels.filter((id) => id !== label.id)
        : [...form.labels, label.id],
    );
  const createLabel = (name: string) => {
    setLabelAnchor(null);
    unwrap(commands.labelCreate(accountId, name))
      .then((label) => setForm((f) => ({ ...f, labels: [...f.labels, label.id] })))
      .catch((e: unknown) =>
        showToast({
          tone: "error",
          message: `Couldn’t create the label: ${e instanceof Error ? e.message : String(e)}`,
        }),
      );
  };

  const fixedAccount = editing || (target.kind === "new" && target.fromMail) || accounts.length < 2;

  return (
    <dialog
      ref={ref}
      aria-labelledby="rule-editor-title"
      onCancel={(e) => {
        e.preventDefault();
        if (labelAnchor) setLabelAnchor(null);
        else if (!save.isPending) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.metaKey) {
          e.preventDefault();
          submit();
        }
      }}
      className="dialog m-auto max-h-[calc(100vh-4rem)] w-[36rem] overflow-y-auto rounded-xl p-5 text-[13px] text-content"
    >
      <header className="mb-4 flex items-center gap-3">
        <h2 id="rule-editor-title" className="flex-1 text-sm font-semibold">
          {editing ? "Edit rule" : target.kind === "copy" ? "Duplicate rule" : "New rule"}
        </h2>
        {fixedAccount ? (
          accounts.length > 1 && (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-content/55">
              <AccountDot account={account} />
              <span className="truncate">{account?.email}</span>
            </span>
          )
        ) : (
          <select
            aria-label="Account"
            value={accountId}
            onChange={(e) => {
              const next = Number(e.target.value) as AccountId;
              setAccountId(next);
              // Labels belong to one account: keep those it has by name.
              set("labels", labelsForAccount(form.labels, allLabels, next));
            }}
            className="max-w-[16rem] truncate rounded-md bg-selection-subtle px-1.5 py-1 text-xs outline-none"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </select>
        )}
      </header>

      <SectionTitle>Mail that matches</SectionTitle>
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
        <TextRow label="From" inputRef={first} value={form.from} onChange={(v) => set("from", v)} />
        <TextRow label="To" value={form.to} onChange={(v) => set("to", v)} />
        <TextRow label="Subject" value={form.subject} onChange={(v) => set("subject", v)} />
        <TextRow
          label="Has the words"
          value={form.hasWords}
          onChange={(v) => set("hasWords", v)}
          placeholder="Any Gmail search"
        />
        <TextRow
          label="Doesn’t have"
          value={form.doesntHave}
          onChange={(v) => set("doesntHave", v)}
        />
        <label htmlFor="rule-size" className="text-content/60">
          Size
        </label>
        <div className="flex min-w-0 gap-1.5">
          <select
            aria-label="Size comparison"
            value={form.sizeComparison}
            onChange={(e) => set("sizeComparison", e.target.value as SizeComparison)}
            className={field}
          >
            <option value="larger">larger than</option>
            <option value="smaller">smaller than</option>
          </select>
          <input
            id="rule-size"
            inputMode="decimal"
            value={form.sizeValue}
            onChange={(e) => set("sizeValue", e.target.value)}
            className={`${field} w-20`}
          />
          <select
            aria-label="Size unit"
            value={form.sizeUnit}
            onChange={(e) => set("sizeUnit", e.target.value as SizeUnit)}
            className={field}
          >
            <option value="mb">MB</option>
            <option value="kb">KB</option>
            <option value="bytes">bytes</option>
          </select>
        </div>
        <span />
        <Check
          label="Has an attachment"
          on={form.hasAttachment}
          onChange={(v) => set("hasAttachment", v)}
        />
      </div>
      <p
        aria-live="polite"
        className={`mt-2 h-4 pl-[7.75rem] text-xs transition-opacity ${
          matches.isFetching ? "text-content/35" : "text-content/50"
        }`}
      >
        {counting && matches.error ? "Couldn’t count matching mail." : matchText(count)}
      </p>

      <SectionTitle>Do this</SectionTitle>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <Check
          label="Skip the Inbox (archive it)"
          on={form.skipInbox}
          onChange={(v) => set("skipInbox", v)}
        />
        <Check label="Mark as read" on={form.markRead} onChange={(v) => set("markRead", v)} />
        <Check label="Star it" on={form.star} onChange={(v) => set("star", v)} />
        <Check
          label="Never send it to Spam"
          on={form.neverSpam}
          onChange={(v) => set("neverSpam", v)}
        />
        <Check label="Delete it" on={form.trash} onChange={(v) => set("trash", v)} />
      </div>
      <div className="mt-3 grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
        <span className="text-content/60">Labels</span>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {form.labels.map((id) => {
            const label = userLabels.find((l) => l.id === id);
            return (
              <span
                key={id}
                className="flex h-6 items-center gap-1 rounded bg-selection pr-1 pl-2 text-xs"
                style={
                  label?.colorBg
                    ? { background: label.colorBg, color: label.colorFg ?? undefined }
                    : undefined
                }
              >
                {label ? pickerName(label) : "…"}
                <button
                  type="button"
                  aria-label={`Remove label ${label?.name ?? ""}`}
                  onClick={() =>
                    set(
                      "labels",
                      form.labels.filter((l) => l !== id),
                    )
                  }
                  className="rounded opacity-60 hover:opacity-100"
                >
                  <ClearIcon size={12} />
                </button>
              </span>
            );
          })}
          <button
            type="button"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setLabelAnchor((open) => (open ? null : { x: r.left, y: r.bottom + 4 }));
            }}
            className="h-6 rounded-md px-2 text-xs text-accent hover:bg-selection"
          >
            {form.labels.length ? "Add another" : "Add a label"}
          </button>
        </div>
        <label htmlFor="rule-importance" className="text-content/60">
          Importance
        </label>
        <select
          id="rule-importance"
          value={form.importance}
          onChange={(e) => set("importance", e.target.value as Importance)}
          className={`${field} justify-self-start`}
        >
          <option value="leave">Leave as Gmail decides</option>
          <option value="always">Always mark as important</option>
          <option value="never">Never mark as important</option>
        </select>
        <label htmlFor="rule-category" className="text-content/60">
          Category
        </label>
        <select
          id="rule-category"
          value={form.category ?? ""}
          onChange={(e) => set("category", (e.target.value || null) as Category | null)}
          className={`${field} justify-self-start`}
        >
          <option value="">Leave as Gmail decides</option>
          {(Object.keys(CATEGORY_NAMES) as Category[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_NAMES[c]}
            </option>
          ))}
        </select>
        {form.forwardTo && (
          <>
            <span className="text-content/60">Forward</span>
            <span className="text-content/60">
              To {form.forwardTo}. Set up in Gmail; kept as it is.
            </span>
          </>
        )}
      </div>

      <div className="mt-5 border-t border-stroke pt-4">
        <Check
          label={applyText(count)}
          on={form.applyToExisting}
          onChange={(v) => set("applyToExisting", v)}
        />
        {save.error ? (
          <p className="selectable mt-3 text-xs text-danger">{save.error.message}</p>
        ) : (
          problem && <p className="mt-3 text-xs text-content/50">{problem}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={save.isPending}
            onClick={onClose}
            className="h-7 rounded-md bg-selection px-3 hover:bg-selection-strong disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            title="⌘↩"
            disabled={problem !== null || save.isPending}
            onClick={submit}
            className="h-7 rounded-md bg-accent px-3 font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            {save.isPending
              ? form.applyToExisting
                ? "Saving and applying…"
                : "Saving…"
              : editing
                ? "Save rule"
                : "Create rule"}
          </button>
        </div>
      </div>

      {labelAnchor && (
        <LabelPicker
          anchor={labelAnchor}
          labels={userLabels}
          // The rule stands in for the conversations the picker usually labels.
          targets={[{ accountId, labelIds: form.labels }]}
          onToggle={toggleLabel}
          onCreate={createLabel}
          onClose={() => setLabelAnchor(null)}
        />
      )}
    </dialog>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-1 mb-2 text-xs font-semibold text-content/70">{children}</h3>;
}

function TextRow({
  label,
  value,
  onChange,
  placeholder,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const id = `rule-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <>
      <label htmlFor={id} className="text-content/60">
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className={field}
      />
    </>
  );
}

function Check({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex min-w-0 cursor-default items-center gap-2">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 shrink-0 accent-accent"
      />
      <span className="truncate">{label}</span>
    </label>
  );
}

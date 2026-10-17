import type { Account, Identity, ThreadDetail } from "../../../platform/tauri/bindings";
import {
  ForwardIcon,
  type IconProps,
  PopOutIcon,
  ReplyAllIcon,
  ReplyIcon,
} from "../../../shared/ui/icons";
import { type ComposeEntry, poppedReplyIn, replyIn } from "../model/composeState";
import { canSwitchKind, type ComposeKind, editorKey } from "../model/draft";
import { ComposeForm } from "./ComposeForm";
import { useEffect, useRef, useState } from "react";
import type { MessageId } from "../../../platform/tauri/bindings";
import {
  closeDraft,
  draftFinished,
  expandCard,
  popOutReply,
  resumeDraft,
  updateDraft,
  useComposeState,
} from "./useCompose";

type ReplyKind = Exclude<ComposeKind, "new">;

const KIND_LABELS: Record<ReplyKind, string> = {
  reply: "Reply",
  replyAll: "Reply all",
  forward: "Forward",
};

/**
 * The foot of a conversation: Reply / Reply all / Forward, or the reply
 * being written there (inline, as Gmail does), which can switch kind or
 * pop out into the floating card.
 */
export function ReplyArea({
  detail,
  identities,
  accounts,
  onStart,
  onSwitch,
  onSend,
}: {
  detail: ThreadDetail;
  identities: Identity[];
  accounts: Account[];
  onStart: (kind: ReplyKind) => void;
  /** Turns the reply being written into another kind, keeping its text. */
  onSwitch: (id: number, kind: ReplyKind) => void;
  onSend: (entry: ComposeEntry) => void;
}) {
  const compose = useComposeState();
  const reply = replyIn(compose, detail.thread.id);
  const popped = poppedReplyIn(compose, detail.thread.id);
  // A draft reply saved in this conversation (here or in Gmail elsewhere)
  // opens as the reply being written, as in Gmail, once per visit.
  const pendingDraft = detail.messages.findLast((m) => m.draft);
  const resumeId =
    !reply &&
    !popped &&
    pendingDraft &&
    detail.messages.some((m) => !m.draft) &&
    !draftFinished(pendingDraft.id)
      ? pendingDraft.id
      : null;
  const asked = useRef<MessageId | null>(null);
  const [failed, setFailed] = useState<MessageId | null>(null);
  useEffect(() => {
    if (resumeId === null || asked.current === resumeId) return;
    asked.current = resumeId;
    void resumeDraft(resumeId).then((ok) => {
      if (!ok) setFailed(resumeId);
    });
  }, [resumeId]);
  if (reply) {
    const { draft } = reply;
    const account = accounts.find((a) => a.id === draft.accountId);
    return (
      <section
        aria-label="Reply"
        className="message-card mt-2 rounded-[10px] ring-1 ring-stroke ring-inset"
        style={{ boxShadow: `inset 3px 0 0 ${account?.color ?? "transparent"}` }}
      >
        <div className="flex items-center gap-2 pt-2 pr-2 pl-3 text-xs text-content/50">
          {canSwitchKind(draft) ? (
            // As Gmail's menu by the reply arrow: switch without starting over.
            <select
              aria-label="Kind of reply"
              title="Change to reply, reply all or forward"
              value={draft.kind}
              disabled={reply.sending}
              onChange={(e) => onSwitch(draft.id, e.target.value as ReplyKind)}
              className="rounded bg-transparent px-1 py-0.5 outline-none hover:bg-selection hover:text-content"
            >
              {(Object.keys(KIND_LABELS) as ReplyKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          ) : (
            <span className="px-1">{KIND_LABELS[draft.kind === "new" ? "reply" : draft.kind]}</span>
          )}
          <button
            type="button"
            aria-label="Pop out"
            title="Pop out (keep writing while you read other mail)"
            disabled={reply.sending}
            onClick={() => popOutReply(draft.id)}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-content/60 hover:bg-selection hover:text-content"
          >
            <PopOutIcon size={14} />
          </button>
        </div>
        <ComposeForm
          key={editorKey(draft)}
          entry={reply}
          identities={identities}
          accounts={accounts}
          inline
          onChange={(change) => updateDraft(draft.id, change)}
          onSend={() => onSend(reply)}
          onDiscard={() => closeDraft(draft.id)}
        />
      </section>
    );
  }
  if (popped)
    return (
      <div className="flex items-center gap-2 px-1 pt-3 pb-4 text-xs text-content/50">
        Your {KIND_LABELS[popped.draft.kind === "new" ? "reply" : popped.draft.kind].toLowerCase()}{" "}
        is open in its own card.
        <button
          type="button"
          onClick={() => expandCard(popped.draft.id)}
          className="rounded px-1.5 py-0.5 text-content/70 ring-1 ring-stroke ring-inset hover:bg-selection hover:text-content"
        >
          Show it
        </button>
      </div>
    );
  if (resumeId !== null && failed !== resumeId)
    return <div className="px-4 pt-3 pb-4 text-xs text-content/45">Opening your draft…</div>;
  // Reply all only when there's someone else to include.
  const last = detail.messages.findLast((m) => !m.draft);
  const several = last ? last.to.length + last.cc.length > 1 : false;
  return (
    <div className="flex gap-2 px-1 pt-3 pb-4">
      <ReplyButton icon={ReplyIcon} label="Reply" shortcut="r" onClick={() => onStart("reply")} />
      {several && (
        <ReplyButton
          icon={ReplyAllIcon}
          label="Reply all"
          shortcut="a"
          onClick={() => onStart("replyAll")}
        />
      )}
      <ReplyButton
        icon={ForwardIcon}
        label="Forward"
        shortcut="f"
        onClick={() => onStart("forward")}
      />
    </div>
  );
}

function ReplyButton({
  icon: Icon,
  label,
  shortcut,
  onClick,
}: {
  icon: (props: IconProps) => React.ReactNode;
  label: string;
  shortcut: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={`${label} (${shortcut})`}
      onClick={onClick}
      className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] text-content/75 ring-1 ring-stroke ring-inset hover:bg-selection hover:text-content"
    >
      <Icon size={15} />
      {label}
    </button>
  );
}

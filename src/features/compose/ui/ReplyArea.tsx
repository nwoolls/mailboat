import type { Account, Identity, ThreadDetail } from "../../../platform/tauri/bindings";
import { ForwardIcon, type IconProps, ReplyAllIcon, ReplyIcon } from "../../../shared/ui/icons";
import { type ComposeEntry, replyIn } from "../model/composeState";
import { type ComposeKind, editorKey } from "../model/draft";
import { ComposeForm } from "./ComposeForm";
import { closeDraft, updateDraft, useComposeState } from "./useCompose";

/**
 * The foot of a conversation: Reply / Reply all / Forward, or the reply
 * being written there (inline, as Gmail does).
 */
export function ReplyArea({
  detail,
  identities,
  accounts,
  onStart,
  onSend,
}: {
  detail: ThreadDetail;
  identities: Identity[];
  accounts: Account[];
  onStart: (kind: Exclude<ComposeKind, "new">) => void;
  onSend: (entry: ComposeEntry) => void;
}) {
  const reply = replyIn(useComposeState(), detail.thread.id);
  if (reply) {
    const { draft } = reply;
    const account = accounts.find((a) => a.id === draft.accountId);
    return (
      <section
        aria-label="Reply"
        className="message-card mt-2 rounded-[10px] ring-1 ring-stroke ring-inset"
        style={{ boxShadow: `inset 3px 0 0 ${account?.color ?? "transparent"}` }}
      >
        <div className="px-4 pt-3 text-xs text-content/50">
          {draft.kind === "forward" ? "Forward" : draft.kind === "replyAll" ? "Reply all" : "Reply"}
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
  // Reply all only when there's someone else to include.
  const last = detail.messages.at(-1);
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

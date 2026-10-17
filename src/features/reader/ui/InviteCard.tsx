import type { AccountId, Answer, MessageId } from "../../../platform/tauri/bindings";
import { commands } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { useAccounts, useInviteAction, useInviteCard } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import { CalendarIcon } from "../../../shared/ui/icons";
import { useSignIn } from "../../accounts/ui/useSignIn";
import {
  answerText,
  canAnswer,
  canRemove,
  clashText,
  currentAnswer,
  headline,
  whenText,
} from "../model/invite";

const ANSWERS: { answer: Answer; label: string }[] = [
  { answer: "yes", label: "Yes" },
  { answer: "maybe", label: "Maybe" },
  { answer: "no", label: "No" },
];

/**
 * A meeting invitation at the top of its message: what, when, where, who,
 * clashes on your calendar, and Yes / Maybe / No through Google Calendar
 * (instead of the email's own buttons, which open the browser).
 */
export function InviteCard({
  messageId,
  accountId,
}: {
  messageId: MessageId;
  accountId: AccountId;
}) {
  const query = useInviteCard(messageId, true);
  const action = useInviteAction(messageId);
  const signIn = useSignIn();
  const account = useAccounts().data?.find((a) => a.id === accountId);
  const card = query.data;
  if (!card) return null;
  const { invite, calendar } = card;
  const answer = currentAnswer(card);
  const clash = calendar.kind === "onCalendar" ? clashText(calendar.clashes) : null;
  const run = (what: Answer | "remove") =>
    action.mutate(what, {
      onError: (e) =>
        showToast({
          tone: "error",
          message: `Couldn’t ${what === "remove" ? "remove the event" : "answer"}: ${e.message}`,
        }),
    });
  const details = [
    whenText(invite.start, invite.end),
    invite.location,
    invite.organizer && `Organizer: ${invite.organizer.name ?? invite.organizer.email}`,
  ].filter(Boolean);

  return (
    <div className="message-notice-strong mb-3 rounded-lg px-3 py-2.5 text-[13px]">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-content/55">
          <CalendarIcon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-content/50">{headline(invite, calendar)}</div>
          <div className="selectable truncate font-medium">{invite.title ?? "Untitled event"}</div>
          <div className="selectable mt-0.5 text-xs text-content/60">{details.join(" · ")}</div>
          {clash && <div className="mt-0.5 text-xs text-warn">{clash}</div>}
          {calendar.kind === "needsSignIn" && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-content/60">
              Sign in to this account again to answer from Mailboat.
              <button
                type="button"
                disabled={signIn.pending}
                onClick={() => signIn.start(account?.email ?? null)}
                className="text-accent hover:underline disabled:opacity-50"
              >
                {signIn.pending ? "Waiting for browser…" : "Sign in again"}
              </button>
            </div>
          )}
          {calendar.kind === "unavailable" && (
            <div className="selectable mt-1.5 text-xs text-content/60">{calendar.message}</div>
          )}
          {(canAnswer(card) || canRemove(card)) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {canAnswer(card) &&
                ANSWERS.map(({ answer: a, label }) => (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={answer === a}
                    disabled={action.isPending}
                    onClick={() => run(a)}
                    className={`rounded-md px-3 py-1 text-xs transition-colors duration-[120ms] disabled:opacity-50 ${
                      answer === a
                        ? "bg-accent text-white"
                        : "bg-content/8 text-content/80 hover:bg-content/12 hover:text-content"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              {canRemove(card) && (
                <button
                  type="button"
                  disabled={action.isPending}
                  onClick={() => run("remove")}
                  className="rounded-md bg-content/8 px-3 py-1 text-xs text-content/80 hover:bg-content/12 hover:text-content disabled:opacity-50"
                >
                  Remove from calendar
                </button>
              )}
              {canAnswer(card) && (
                <span className="ml-1 text-xs text-content/50">{answerText(answer)}</span>
              )}
              {calendar.kind === "onCalendar" && calendar.link && (
                <button
                  type="button"
                  onClick={() => void unwrap(commands.linkOpen(calendar.link!)).catch(() => {})}
                  className="ml-auto text-xs text-content/50 hover:text-content hover:underline"
                >
                  Open in Calendar
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

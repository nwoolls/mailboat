import { useCodexAccept, useCodexCheck } from "../../../shared/lib/queries";
import { Button } from "../../settings/ui/controls";
import { codexNotice } from "../model/codexCheck";

/**
 * ChatGPT paused because Codex has settings that haven't been reviewed and
 * won't turn off, or couldn't be checked (Milestone 13, Codex fenced in).
 */
export function CodexNoticeCard({ connected }: { connected: boolean }) {
  const check = useCodexCheck(connected);
  const accept = useCodexAccept();
  const notice = codexNotice(check.data, connected);
  if (!notice) return null;
  const checkedAt = new Date(check.dataUpdatedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <section
      role="status"
      className="mb-8 rounded-xl border border-danger/30 bg-danger/[0.06] px-4 py-3 text-[12px] leading-relaxed"
    >
      <h2 className="text-[13px] font-semibold text-content">⚠ {notice.title}</h2>
      <p className="mt-1 text-content/70">{notice.body}</p>
      {notice.switches.length > 0 && (
        <p className="selectable mt-2 text-content/70">
          Not reviewed: <span className="font-mono text-[11px]">{notice.switches.join(", ")}</span>
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <span className="flex-1 text-content/45">Checked {checkedAt}</span>
        <Button onClick={() => void check.refetch()} disabled={check.isFetching}>
          Check again
        </Button>
        {notice.canUseAnyway && (
          <Button danger onClick={() => accept.mutate(notice.switches)} disabled={accept.isPending}>
            Use anyway
          </Button>
        )}
      </div>
    </section>
  );
}

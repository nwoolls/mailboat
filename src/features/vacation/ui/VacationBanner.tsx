import type { Account } from "../../../platform/tauri/bindings";
import { useSaveVacation, useVacations } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import { AccountDot } from "../../../shared/ui/AccountDot";
import { VacationIcon } from "../../../shared/ui/icons";
import { bannerText } from "../model/vacationForm";

/**
 * Above the conversation list while an account's vacation responder is
 * replying (as Gmail's banner), so it's never left on by mistake: what's
 * on, until when, and Turn off.
 */
export function VacationBanner({
  accounts,
  onOpenSettings,
}: {
  accounts: Account[];
  onOpenSettings: () => void;
}) {
  const vacations = useVacations().data ?? [];
  const save = useSaveVacation();
  const active = vacations.flatMap((v) =>
    v.state.kind === "ready" && v.state.active
      ? [{ id: v.accountId, settings: v.state.settings }]
      : [],
  );
  if (active.length === 0) return null;
  return (
    <div className="mx-2 mb-1 flex flex-col gap-1">
      {active.map(({ id, settings }) => {
        const account = accounts.find((a) => a.id === id);
        return (
          <div
            key={id}
            role="status"
            className="flex items-center gap-2 rounded-lg bg-warn/10 px-3 py-1.5 text-xs text-content/80"
          >
            <VacationIcon size={14} className="shrink-0 text-warn" />
            {accounts.length > 1 && <AccountDot account={account} />}
            <span className="min-w-0 flex-1 truncate">
              {bannerText(settings, accounts.length > 1 ? (account?.email ?? null) : null)}
            </span>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() =>
                save.mutate(
                  { account: id, settings: { ...settings, enabled: false } },
                  {
                    onSuccess: () => showToast({ message: "Vacation responder turned off" }),
                    onError: (e) =>
                      showToast({
                        tone: "error",
                        message: `Couldn’t turn it off: ${e.message}`,
                      }),
                  },
                )
              }
              className="shrink-0 rounded px-1.5 py-0.5 font-medium hover:bg-selection disabled:opacity-50"
            >
              Turn off
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="shrink-0 rounded px-1.5 py-0.5 hover:bg-selection"
            >
              Settings
            </button>
          </div>
        );
      })}
    </div>
  );
}

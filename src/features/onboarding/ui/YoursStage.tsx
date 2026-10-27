import type { AppSettings, NotifyFor, Theme } from "../../../platform/tauri/bindings";
import { APP_NAME } from "../../../shared/lib/brand";
import { IS_MAC } from "../../../shared/lib/platform";
import { useAppInfo, useAppSettings, useSaveAppSettings } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import { ACCENTS } from "../../settings/model/appearance";
import { iconSetting, shownIcon } from "../../settings/model/appIcon";
import { AppIconPicker } from "../../settings/ui/AppIconPicker";
import { Segmented, Swatches } from "../../settings/ui/controls";
import { useAppearance } from "../../settings/ui/useAppearance";
import { plainError } from "../model/onboarding";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const NOTIFY: { value: NotifyFor; label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "allNew", label: "All new mail" },
];

/**
 * Make it yours: a few choices from Settings, all optional. Each applies
 * at once, so the window changes as you pick.
 */
export function YoursStage({ onFinish }: { onFinish: () => void }) {
  const [appearance, setAppearance] = useAppearance();
  const settings = useAppSettings().data;
  const save = useSaveAppSettings();
  const iconChoices = useAppInfo().data?.iconChoices ?? [];
  const change = (next: Partial<AppSettings>) =>
    settings &&
    save.mutate(
      { ...settings, ...next },
      {
        onError: (e) => showToast({ tone: "error", message: `Couldn’t save: ${plainError(e)}` }),
      },
    );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">Make it yours</h1>
        <p className="mt-1 text-content/60">
          All optional, and all in Settings later. Your mail keeps syncing meanwhile.
        </p>
      </header>
      <div className="divide-y divide-stroke rounded-xl bg-selection-subtle ring-1 ring-stroke">
        <Choice label="Theme">
          <Segmented
            label="Theme"
            value={settings?.theme ?? "system"}
            options={THEMES}
            onChange={(theme) => change({ theme })}
            disabled={!settings}
          />
        </Choice>
        <Choice label="Accent colour">
          <Swatches
            label="Accent colour"
            value={appearance.accent}
            options={ACCENTS.map((a) => ({ value: a.id, label: a.label, color: a.color }))}
            onChange={(accent) => setAppearance({ ...appearance, accent })}
          />
        </Choice>
        <Choice label="Notify me about">
          <Segmented
            label="Notify me about"
            value={settings?.notifyFor ?? "inbox"}
            options={NOTIFY}
            onChange={(notifyFor) => change({ notifyFor })}
            disabled={!settings}
          />
        </Choice>
        {IS_MAC && iconChoices.length > 1 && (
          <div className="px-4 py-3">
            <div className="text-[13px]">App icon</div>
            <AppIconPicker
              choices={iconChoices}
              value={shownIcon(settings?.appIcon)}
              onChange={(choice) => change({ appIcon: iconSetting(choice) })}
              disabled={!settings}
            />
          </div>
        )}
      </div>
      <button
        type="button"
        autoFocus
        onClick={onFinish}
        className="rounded-md bg-accent px-4 py-2 font-medium text-white"
      >
        Open {APP_NAME}
      </button>
    </div>
  );
}

function Choice({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-[13px]">{label}</span>
      {children}
    </div>
  );
}

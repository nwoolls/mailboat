import { sectionFor, type SettingsSectionId } from "../model/sections";
import { IS_MAC } from "../../../shared/lib/platform";

/** Room for the macOS traffic lights, as in the mail toolbar. */
const TRAFFIC_LIGHTS_WIDTH = IS_MAC ? 80 : 8;

/** The title bar while Settings is open: drags the window and says where you are. */
export function SettingsTitleBar({ section }: { section: SettingsSectionId }) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center gap-2 pr-2 text-[13px]"
      style={{ paddingLeft: TRAFFIC_LIGHTS_WIDTH + 8 }}
    >
      <span data-tauri-drag-region className="text-content/45">
        Settings
      </span>
      <span data-tauri-drag-region aria-hidden className="text-content/25">
        /
      </span>
      <span data-tauri-drag-region className="truncate text-content">
        {sectionFor(section).label}
      </span>
    </header>
  );
}

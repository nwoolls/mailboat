import {
  AccountsIcon,
  AdvancedIcon,
  AppearanceIcon,
  BackIcon,
  GeneralIcon,
  type IconProps,
  KeyboardIcon,
  NotificationIcon,
  RulesIcon,
} from "../../../shared/ui/icons";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "../model/sections";

const ICONS: Record<SettingsSectionId, (props: IconProps) => React.ReactNode> = {
  general: GeneralIcon,
  accounts: AccountsIcon,
  notifications: NotificationIcon,
  appearance: AppearanceIcon,
  rules: RulesIcon,
  keyboard: KeyboardIcon,
  advanced: AdvancedIcon,
};

/**
 * The sidebar while Settings is open (as MonoCode's `SettingsNav`): the
 * sections, with Back at the foot where the "+" and gear usually are.
 */
export function SettingsNav({
  section,
  width,
  onSelect,
  onClose,
}: {
  section: SettingsSectionId;
  width: number;
  onSelect: (section: SettingsSectionId) => void;
  onClose: () => void;
}) {
  return (
    <nav aria-label="Settings" className="flex h-full shrink-0 flex-col" style={{ width }}>
      <div className="flex-1 overflow-y-auto pb-4 pl-2">
        <div className="mt-2 mb-1 flex h-7 items-center pl-2 text-[11px] font-medium tracking-wide text-content/45">
          Settings
        </div>
        {SETTINGS_SECTIONS.map((s) => (
          <NavRow
            key={s.id}
            label={s.label}
            icon={ICONS[s.id]}
            selected={s.id === section}
            onClick={() => onSelect(s.id)}
          />
        ))}
      </div>
      <div className="flex h-9 shrink-0 items-center pb-1 pl-2">
        <NavRow label="Back" icon={BackIcon} title="Back to mail (Esc)" onClick={onClose} />
      </div>
    </nav>
  );
}

/** A row like the mail sidebar's: a 16px icon, then the name. */
function NavRow({
  label,
  icon: Icon,
  selected = false,
  title,
  onClick,
}: {
  label: string;
  icon: (props: IconProps) => React.ReactNode;
  selected?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-current={selected ? "page" : undefined}
      className={`flex h-7 w-full items-center gap-2 rounded-md pl-2 text-left text-[13px] transition-colors duration-[120ms] ${
        selected
          ? "bg-selection-strong text-content"
          : "text-content/75 hover:bg-selection hover:text-content"
      }`}
    >
      <span
        className={`flex w-4 shrink-0 justify-center ${selected ? "text-content" : "text-content/55"}`}
      >
        <Icon size={15} />
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

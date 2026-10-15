import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from "@hugeicons/react";
import Archive02 from "@hugeicons/core-free-icons/Archive02Icon";
import Delete02 from "@hugeicons/core-free-icons/Delete02Icon";
import MailOpen01 from "@hugeicons/core-free-icons/MailOpen01Icon";
import MoreHorizontal from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import PencilEdit02 from "@hugeicons/core-free-icons/PencilEdit02Icon";
import SidebarLeft from "@hugeicons/core-free-icons/SidebarLeftIcon";
import SidebarRight from "@hugeicons/core-free-icons/SidebarRightIcon";
import Star from "@hugeicons/core-free-icons/StarIcon";
import Tag01 from "@hugeicons/core-free-icons/Tag01Icon";

/**
 * The app's icons: Hugeicons outline set, as MonoCode uses. Each icon is
 * imported on its own so only these end up in the bundle.
 */
export type IconProps = Omit<HugeiconsIconProps, "icon">;

function wrap(icon: IconSvgElement) {
  return function Icon({ size = 16, strokeWidth = 1.75, ...props }: IconProps) {
    return <HugeiconsIcon icon={icon} size={size} strokeWidth={strokeWidth} {...props} />;
  };
}

export const ArchiveIcon = wrap(Archive02);
export const ComposeIcon = wrap(PencilEdit02);
export const LabelIcon = wrap(Tag01);
export const MarkUnreadIcon = wrap(MailOpen01);
export const MoreIcon = wrap(MoreHorizontal);
export const ReaderToggleIcon = wrap(SidebarRight);
export const SidebarToggleIcon = wrap(SidebarLeft);
export const StarIcon = wrap(Star);
export const TrashIcon = wrap(Delete02);

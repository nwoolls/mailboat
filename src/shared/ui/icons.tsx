import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from "@hugeicons/react";
import Add01 from "@hugeicons/core-free-icons/Add01Icon";
import AlertCircle from "@hugeicons/core-free-icons/AlertCircleIcon";
import Archive02 from "@hugeicons/core-free-icons/Archive02Icon";
import ArrowRight01 from "@hugeicons/core-free-icons/ArrowRight01Icon";
import Attachment01 from "@hugeicons/core-free-icons/Attachment01Icon";
import Cancel01 from "@hugeicons/core-free-icons/Cancel01Icon";
import Delete02 from "@hugeicons/core-free-icons/Delete02Icon";
import File01 from "@hugeicons/core-free-icons/File01Icon";
import Flag02 from "@hugeicons/core-free-icons/Flag02Icon";
import Inbox from "@hugeicons/core-free-icons/InboxIcon";
import Mail01 from "@hugeicons/core-free-icons/Mail01Icon";
import Mail02 from "@hugeicons/core-free-icons/Mail02Icon";
import MailOpen01 from "@hugeicons/core-free-icons/MailOpen01Icon";
import MoreHorizontal from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import PencilEdit02 from "@hugeicons/core-free-icons/PencilEdit02Icon";
import Search01 from "@hugeicons/core-free-icons/Search01Icon";
import Sent from "@hugeicons/core-free-icons/SentIcon";
import Shield01 from "@hugeicons/core-free-icons/Shield01Icon";
import SidebarLeft from "@hugeicons/core-free-icons/SidebarLeftIcon";
import SidebarRight from "@hugeicons/core-free-icons/SidebarRightIcon";
import Star from "@hugeicons/core-free-icons/StarIcon";
import Tag01 from "@hugeicons/core-free-icons/Tag01Icon";
import ThumbsUp from "@hugeicons/core-free-icons/ThumbsUpIcon";

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

export const AlertIcon = wrap(AlertCircle);
export const AddIcon = wrap(Add01);
export const AllMailIcon = wrap(Mail01);
export const AttachmentIcon = wrap(Attachment01);
export const ChevronIcon = wrap(ArrowRight01);
export const InboxIcon = wrap(Inbox);
export const UnreadIcon = wrap(Mail02);
export const ArchiveIcon = wrap(Archive02);
export const ClearIcon = wrap(Cancel01);
export const ComposeIcon = wrap(PencilEdit02);
export const DraftIcon = wrap(File01);
export const ImportantIcon = wrap(Flag02);
export const LabelIcon = wrap(Tag01);
export const MarkUnreadIcon = wrap(MailOpen01);
export const MoreIcon = wrap(MoreHorizontal);
export const ReaderToggleIcon = wrap(SidebarRight);
export const SearchIcon = wrap(Search01);
export const SentIcon = wrap(Sent);
export const SidebarToggleIcon = wrap(SidebarLeft);
export const SpamIcon = wrap(Shield01);
export const StarIcon = wrap(Star);
export const ThumbsUpIcon = wrap(ThumbsUp);
export const TrashIcon = wrap(Delete02);

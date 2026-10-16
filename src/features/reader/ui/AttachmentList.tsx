import { useMutation } from "@tanstack/react-query";
import { commands } from "../../../platform/tauri/bindings";
import type { Attachment, AttachmentId } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { showToast } from "../../../shared/lib/toast";
import {
  FileIcon,
  type IconProps,
  ImageIcon,
  PdfIcon,
  PreviewIcon,
  SaveIcon,
} from "../../../shared/ui/icons";
import { type FileKind, fileKind, formatSize, shownName } from "../model/attachments";

const KIND_ICONS: Record<FileKind, (props: IconProps) => React.ReactNode> = {
  image: ImageIcon,
  pdf: PdfIcon,
  file: FileIcon,
};

type Verb = "open" | "preview" | "save";

/**
 * A message's attachments as chips under its body. Click to open with the
 * default app; the eye shows Quick Look, the arrow saves to Downloads.
 * Rust downloads each file once (with the message's own account) and
 * marks it as downloaded from the internet, so macOS checks it first.
 */
export function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  const run = useMutation({
    mutationFn: ({ id, verb }: { id: AttachmentId; verb: Verb }) => {
      switch (verb) {
        case "open":
          return unwrap(commands.attachmentOpen(id));
        case "preview":
          return unwrap(commands.attachmentPreview(id));
        case "save":
          return unwrap(commands.attachmentSave(id));
      }
    },
    onSuccess: (result, { id, verb }) => {
      if (verb !== "save" || typeof result !== "string") return;
      showToast({
        message: `Saved “${result}” to Downloads`,
        action: {
          label: "Show in Finder",
          run: () => void unwrap(commands.attachmentReveal(id)).catch(() => {}),
        },
      });
    },
    onError: (error, { verb }) =>
      showToast({
        tone: "error",
        message: `Couldn’t ${verb === "save" ? "save" : "open"} the attachment: ${error.message}`,
      }),
  });
  if (attachments.length === 0) return null;
  const busy = (id: AttachmentId) => run.isPending && run.variables?.id === id;

  return (
    <ul aria-label="Attachments" className="mt-3 flex flex-wrap gap-2">
      {attachments.map((a) => {
        const Icon = KIND_ICONS[fileKind(a)];
        const name = shownName(a);
        const working = busy(a.id);
        return (
          <li
            key={a.id}
            className={`message-notice group flex h-9 max-w-[280px] items-center rounded-lg text-xs transition-opacity ${
              working ? "opacity-60" : ""
            }`}
          >
            <button
              type="button"
              title={`Open ${name}`}
              disabled={working}
              onClick={() => run.mutate({ id: a.id, verb: "open" })}
              className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-l-lg pr-1 pl-2.5 text-left hover:bg-selection"
            >
              <Icon size={15} className="shrink-0 text-content/55" />
              <span className="min-w-0 truncate font-medium text-content/85">{name}</span>
              <span className="shrink-0 text-content/45">
                {working ? "Opening…" : formatSize(a.size)}
              </span>
            </button>
            <ChipButton
              label={`Quick Look ${name}`}
              icon={PreviewIcon}
              disabled={working}
              onClick={() => run.mutate({ id: a.id, verb: "preview" })}
            />
            <ChipButton
              label={`Save ${name} to Downloads`}
              icon={SaveIcon}
              disabled={working}
              onClick={() => run.mutate({ id: a.id, verb: "save" })}
              last
            />
          </li>
        );
      })}
    </ul>
  );
}

function ChipButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  last,
}: {
  label: string;
  icon: (props: IconProps) => React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-full w-7 shrink-0 items-center justify-center text-content/50 hover:bg-selection hover:text-content ${
        last ? "rounded-r-lg" : ""
      }`}
    >
      <Icon size={14} />
    </button>
  );
}

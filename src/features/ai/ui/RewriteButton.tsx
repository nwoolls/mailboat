import { type Editor, useEditorState } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { commands, type RewriteAnswer, type RewriteStyle } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { useAiStatus, useAppSettings } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import {
  FormalIcon,
  FriendlierIcon,
  type IconProps,
  RewriteIcon,
  ShorterIcon,
  SpellCheckIcon,
} from "../../../shared/ui/icons";
import { Menu, type MenuAnchor, MenuItem } from "../../../shared/ui/Menu";
import { aiChoices, canWrite, PROVIDER_NAMES } from "../model/providers";
import { BLOCK_SEPARATOR, REWRITE_STYLES, rewriteContent } from "../model/rewrite";
import { dropText, newRequestId } from "./stream";

/**
 * Puts a rewrite in place of the text it was made from, selected, so it
 * can be rewritten again straight away. One undo step. False, changing
 * nothing, if that text was edited meanwhile: typing wins.
 */
export function applyRewrite(
  editor: Editor,
  at: { from: number; to: number; original: string },
  answer: RewriteAnswer,
): boolean {
  const { from, to, original } = at;
  if (to > editor.state.doc.content.size) return false;
  if (editor.state.doc.textBetween(from, to, BLOCK_SEPARATOR) !== original) return false;
  editor.chain().focus().insertContentAt({ from, to }, rewriteContent(answer)).run();
  editor.commands.setTextSelection({ from, to: editor.state.selection.to });
  return true;
}

const ICONS: Record<RewriteStyle, (props: IconProps) => React.ReactNode> = {
  shorter: ShorterIcon,
  friendlier: FriendlierIcon,
  moreFormal: FormalIcon,
  fixGrammar: SpellCheckIcon,
};

/**
 * Rewrite in the formatting bar: the selected text made shorter,
 * friendlier, more formal or correct, by the writing provider (Settings
 * → AI). Only the selection is sent. The rewrite replaces it in the
 * editor, selected, for the owner to keep, rewrite again, or undo (⌘Z,
 * or Undo on the toast); nothing is sent by it.
 */
export function RewriteButton({ editor }: { editor: Editor }) {
  const ai = aiChoices(useAppSettings().data);
  const status = useAiStatus().data;
  const selected = useEditorState({
    editor,
    selector: ({ editor: e }) => !e.state.selection.empty,
  });
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [busy, setBusy] = useState(false);
  // The request in flight, stopped if the message closes first.
  const running = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (running.current !== null) void commands.aiCancel(running.current);
    },
    [],
  );
  if (!canWrite(ai, status)) return null;
  const provider = PROVIDER_NAMES[ai.writingProvider];

  const rewrite = async (style: RewriteStyle) => {
    const { from, to } = editor.state.selection;
    const original = editor.state.doc.textBetween(from, to, BLOCK_SEPARATOR);
    const id = newRequestId();
    running.current = id;
    setBusy(true);
    try {
      const answer = await unwrap(commands.aiRewrite(original, style, id));
      if (editor.isDestroyed) return;
      if (!applyRewrite(editor, { from, to, original }, answer)) {
        showToast({
          tone: "error",
          message: "The text changed while it was being rewritten, so it was left as it is.",
        });
        return;
      }
      const after = editor.state.doc;
      showToast({
        message: `Rewritten with ${provider}`,
        action: {
          label: "Undo",
          run: () => {
            // Only while nothing else has changed; after that it's ⌘Z's job.
            if (!editor.isDestroyed && editor.state.doc === after)
              editor.chain().focus().undo().run();
          },
        },
      });
    } catch (e) {
      showToast({ tone: "error", message: `Couldn’t rewrite: ${(e as Error).message}` });
    } finally {
      dropText(id);
      running.current = null;
      setBusy(false);
    }
  };

  const label = busy
    ? `Rewriting with ${provider}…`
    : selected
      ? `Rewrite with ${provider}`
      : "Rewrite: select text first";
  return (
    <>
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-busy={busy}
        disabled={!selected || busy}
        // Keep the editor's selection while clicking.
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left, y: r.bottom + 4 });
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-content/70 hover:bg-selection hover:text-content disabled:opacity-35 disabled:hover:bg-transparent"
      >
        <RewriteIcon size={15} className={busy ? "animate-pulse text-accent" : ""} />
      </button>
      {menu && (
        <Menu anchor={menu} onClose={() => setMenu(null)} label="Rewrite">
          {REWRITE_STYLES.map(({ style, title }) => (
            <MenuItem
              key={style}
              icon={ICONS[style]}
              onSelect={() => {
                setMenu(null);
                void rewrite(style);
              }}
            >
              {title}
            </MenuItem>
          ))}
        </Menu>
      )}
    </>
  );
}

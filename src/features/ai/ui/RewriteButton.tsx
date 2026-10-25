import { type Editor, useEditorState } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import {
  commands,
  type RewriteAnswer,
  type RewriteStyle,
  type ThreadId,
} from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import {
  useAiStatus,
  useAppSettings,
  useConversationLanguage,
  useTranslationLanguages,
} from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import {
  FormalIcon,
  FriendlierIcon,
  type IconProps,
  RewriteIcon,
  ShorterIcon,
  SpellCheckIcon,
  TranslateIcon,
} from "../../../shared/ui/icons";
import { Menu, type MenuAnchor, MenuItem, MenuSeparator } from "../../../shared/ui/Menu";
import { aiChoices, canWrite, PROVIDER_NAMES } from "../model/providers";
import { BLOCK_SEPARATOR, REWRITE_STYLES, rewriteContent } from "../model/rewrite";
import { languageLabel, languageName, pickerLanguages, sameLanguage } from "../model/translate";
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
 * The wand in the formatting bar: the selected text made shorter,
 * friendlier, more formal or correct by the writing provider (Settings →
 * AI), or translated (Apple's translation on the Mac, else the writing
 * provider): into the language of the email being answered when it isn't
 * the Mac's, or any other. Only the selection is sent. The result
 * replaces it in the editor, selected, for the owner to keep, change
 * again, or undo (⌘Z, or Undo on the toast); nothing is sent by it.
 */
export function RewriteButton({ editor, threadId }: { editor: Editor; threadId: ThreadId | null }) {
  const ai = aiChoices(useAppSettings().data);
  const status = useAiStatus().data;
  const selected = useEditorState({
    editor,
    selector: ({ editor: e }) => !e.state.selection.empty,
  });
  const [menu, setMenu] = useState<{ at: MenuAnchor; languages: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const replyLanguage = useConversationLanguage(threadId).data ?? null;
  const languages = useTranslationLanguages(menu?.languages ?? false).data ?? [];
  // The request in flight, stopped if the message closes first.
  const running = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (running.current !== null) void commands.aiCancel(running.current);
    },
    [],
  );
  const write = canWrite(ai, status);
  const provider = PROVIDER_NAMES[ai.writingProvider];
  const mac = navigator.language;
  // Offered by name when the email being answered is in another language.
  const answerIn = replyLanguage && !sameLanguage(replyLanguage, mac) ? replyLanguage : null;

  const change = async (
    ask: (original: string, id: number) => Promise<RewriteAnswer & { by?: string }>,
    done: string,
    failed: string,
  ) => {
    const { from, to } = editor.state.selection;
    const original = editor.state.doc.textBetween(from, to, BLOCK_SEPARATOR);
    const id = newRequestId();
    running.current = id;
    setBusy(true);
    try {
      const answer = await ask(original, id);
      if (editor.isDestroyed) return;
      if (!applyRewrite(editor, { from, to, original }, answer)) {
        showToast({
          tone: "error",
          message: "The text changed meanwhile, so it was left as it is.",
        });
        return;
      }
      const after = editor.state.doc;
      showToast({
        message: `${done} with ${answer.by ?? provider}`,
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
      showToast({ tone: "error", message: `${failed}: ${(e as Error).message}` });
    } finally {
      dropText(id);
      running.current = null;
      setBusy(false);
    }
  };
  const rewrite = (style: RewriteStyle) =>
    change(
      (original, id) => unwrap(commands.aiRewrite(original, style, id)),
      "Rewritten",
      "Couldn’t rewrite",
    );
  const translate = (code: string) =>
    change(
      (original, id) => unwrap(commands.aiTranslate(original, code, languageLabel(code), id)),
      `Translated into ${languageName(code)}`,
      "Couldn’t translate",
    );

  const label = busy
    ? "Working on the selected text…"
    : selected
      ? write
        ? `Rewrite or translate with ${provider}`
        : "Translate"
      : "Rewrite or translate: select text first";
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
          setMenu({ at: { x: r.left, y: r.bottom + 4 }, languages: false });
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-content/70 hover:bg-selection hover:text-content disabled:opacity-35 disabled:hover:bg-transparent"
      >
        <RewriteIcon size={15} className={busy ? "animate-pulse text-accent" : ""} />
      </button>
      {menu && !menu.languages && (
        <Menu anchor={menu.at} onClose={() => setMenu(null)} label="Rewrite or translate">
          {write &&
            REWRITE_STYLES.map(({ style, title }) => (
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
          {write && <MenuSeparator />}
          {answerIn && (
            <MenuItem
              icon={TranslateIcon}
              onSelect={() => {
                setMenu(null);
                void translate(answerIn);
              }}
            >
              Translate into {languageName(answerIn)}
            </MenuItem>
          )}
          <MenuItem icon={TranslateIcon} onSelect={() => setMenu({ at: menu.at, languages: true })}>
            Translate into…
          </MenuItem>
        </Menu>
      )}
      {menu?.languages && (
        <Menu anchor={menu.at} onClose={() => setMenu(null)} label="Translate into">
          <div className="max-h-72 overflow-y-auto">
            {pickerLanguages(languages, mac).map(({ code, name }) => (
              <MenuItem
                key={code}
                icon={TranslateIcon}
                onSelect={() => {
                  setMenu(null);
                  void translate(code);
                }}
              >
                {name}
              </MenuItem>
            ))}
          </div>
        </Menu>
      )}
    </>
  );
}

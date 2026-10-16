import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { useState } from "react";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  BulletListIcon,
  ClearFormattingIcon,
  type IconProps,
  ItalicIcon,
  LinkIcon,
  NumberedListIcon,
  QuoteIcon,
  TextColorIcon,
  UnderlineIcon,
} from "../../../shared/ui/icons";

/** Gmail's font choices, with the stacks Gmail sends. */
const FONTS: [label: string, family: string][] = [
  ["Sans Serif", "Arial, Helvetica, sans-serif"],
  ["Serif", "'Times New Roman', Times, serif"],
  ["Fixed width", "monospace"],
  ["Wide", "'Arial Black', sans-serif"],
  ["Narrow", "'Arial Narrow', sans-serif"],
  ["Comic Sans MS", "'Comic Sans MS', sans-serif"],
  ["Garamond", "Garamond, serif"],
  ["Georgia", "Georgia, serif"],
  ["Tahoma", "Tahoma, sans-serif"],
  ["Trebuchet MS", "'Trebuchet MS', sans-serif"],
  ["Verdana", "Verdana, sans-serif"],
];

/** Gmail's four sizes; "Normal" leaves the reader's default. */
const SIZES: [label: string, size: string][] = [
  ["Small", "10px"],
  ["Normal", ""],
  ["Large", "18px"],
  ["Huge", "32px"],
];

export type EditorChange = { html: string; text: string; edited: boolean };

/**
 * The message text, with Gmail's formatting (TipTap). Reports its HTML
 * and plain text on load and on every change; `edited` is true only once
 * the user has changed something.
 */
export function useRichEditor(initialHtml: string, onChange: (c: EditorChange) => void) {
  const report = (editor: Editor, edited: boolean) =>
    onChange({
      html: editor.isEmpty ? "" : editor.getHTML(),
      text: editor.getText({ blockSeparator: "\n\n" }),
      edited,
    });
  return useEditor({
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      TextStyleKit,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: initialHtml,
    editorProps: {
      attributes: {
        class: "compose-editor selectable min-h-full py-3 leading-relaxed outline-none",
        "aria-label": "Message",
        role: "textbox",
        "aria-multiline": "true",
      },
      // ⌘↩ sends (the form handles it); the editor mustn't also insert a
      // line break, which is what it would otherwise do.
      handleKeyDown: (_view, event) => event.key === "Enter" && event.metaKey,
    },
    onCreate: ({ editor }) => report(editor, false),
    onUpdate: ({ editor }) => report(editor, true),
  });
}

export function EditorBody({ editor, className }: { editor: Editor | null; className?: string }) {
  return <EditorContent editor={editor} className={className} />;
}

/** Gmail's formatting bar: font, size, bold/italic/underline, colour, alignment, lists, quote, link. */
export function FormatBar({ editor }: { editor: Editor | null }) {
  const [linking, setLinking] = useState<string | null>(null);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            quote: e.isActive("blockquote"),
            link: e.isActive("link"),
            center: e.isActive({ textAlign: "center" }),
            right: e.isActive({ textAlign: "right" }),
            font: (e.getAttributes("textStyle").fontFamily as string | undefined) ?? "",
            size: (e.getAttributes("textStyle").fontSize as string | undefined) ?? "",
            color: (e.getAttributes("textStyle").color as string | undefined) ?? "",
          }
        : null,
  });
  if (!editor || !state) return null;
  const chain = () => editor.chain().focus();
  const align = state.center ? "center" : state.right ? "right" : "left";
  const nextAlign = { left: "center", center: "right", right: "left" } as const;

  return (
    <div className="flex flex-col gap-1 px-3">
      <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Formatting">
        <select
          aria-label="Font"
          title="Font"
          value={state.font}
          onChange={(e) =>
            e.target.value
              ? chain().setFontFamily(e.target.value).run()
              : chain().unsetFontFamily().run()
          }
          className="h-7 w-24 rounded-md bg-transparent px-1 text-xs hover:bg-selection"
        >
          <option value="">Font</option>
          {FONTS.map(([label, family]) => (
            <option key={label} value={family} style={{ fontFamily: family }}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Size"
          title="Size"
          value={state.size}
          onChange={(e) =>
            e.target.value
              ? chain().setFontSize(e.target.value).run()
              : chain().unsetFontSize().run()
          }
          className="h-7 w-20 rounded-md bg-transparent px-1 text-xs hover:bg-selection"
        >
          {SIZES.map(([label, size]) => (
            <option key={label} value={size}>
              {label}
            </option>
          ))}
        </select>
        <Sep />
        <Btn
          icon={BoldIcon}
          label="Bold (⌘B)"
          on={state.bold}
          run={() => chain().toggleBold().run()}
        />
        <Btn
          icon={ItalicIcon}
          label="Italic (⌘I)"
          on={state.italic}
          run={() => chain().toggleItalic().run()}
        />
        <Btn
          icon={UnderlineIcon}
          label="Underline (⌘U)"
          on={state.underline}
          run={() => chain().toggleUnderline().run()}
        />
        <label
          title="Text colour"
          className="relative flex h-7 w-7 items-center justify-center rounded-md text-content/70 hover:bg-selection"
        >
          <TextColorIcon size={15} />
          <span
            className="absolute right-1.5 bottom-1 left-1.5 h-0.5 rounded"
            style={{ background: state.color || "currentColor" }}
          />
          <input
            type="color"
            aria-label="Text colour"
            value={state.color.startsWith("#") ? state.color : "#000000"}
            onChange={(e) => chain().setColor(e.target.value).run()}
            className="absolute inset-0 cursor-default opacity-0"
          />
        </label>
        <Sep />
        <Btn
          icon={
            align === "center"
              ? AlignCenterIcon
              : align === "right"
                ? AlignRightIcon
                : AlignLeftIcon
          }
          label={`Align: ${align} (click for ${nextAlign[align]})`}
          run={() => chain().setTextAlign(nextAlign[align]).run()}
        />
        <Btn
          icon={NumberedListIcon}
          label="Numbered list"
          on={state.ordered}
          run={() => chain().toggleOrderedList().run()}
        />
        <Btn
          icon={BulletListIcon}
          label="Bulleted list"
          on={state.bullet}
          run={() => chain().toggleBulletList().run()}
        />
        <Btn
          icon={QuoteIcon}
          label="Quote"
          on={state.quote}
          run={() => chain().toggleBlockquote().run()}
        />
        <Btn
          icon={LinkIcon}
          label={state.link ? "Remove link" : "Link"}
          on={state.link}
          run={() =>
            state.link ? chain().unsetLink().run() : setLinking(linking === null ? "" : null)
          }
        />
        <Btn
          icon={ClearFormattingIcon}
          label="Remove formatting"
          run={() => chain().unsetAllMarks().clearNodes().run()}
        />
      </div>
      {linking !== null && (
        <input
          autoFocus
          aria-label="Link address"
          placeholder="Paste or type a link, then Return"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={linking}
          onChange={(e) => setLinking(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const href = linking.trim();
              if (href) {
                const url = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`;
                if (editor.state.selection.empty)
                  chain()
                    .insertContent({
                      type: "text",
                      text: href,
                      marks: [{ type: "link", attrs: { href: url } }],
                    })
                    .run();
                else chain().setLink({ href: url }).run();
              }
              setLinking(null);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setLinking(null);
              editor.commands.focus();
            }
          }}
          className="h-7 rounded-md bg-selection px-2 text-[13px] outline-none"
        />
      )}
    </div>
  );
}

function Sep() {
  return <span className="mx-1 h-4 w-px bg-stroke" />;
}

function Btn({
  icon: Icon,
  label,
  on,
  run,
}: {
  icon: (props: IconProps) => React.ReactNode;
  label: string;
  on?: boolean;
  run: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      // Keep the editor's selection while clicking.
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-selection hover:text-content ${
        on ? "bg-selection-strong text-content" : "text-content/70"
      }`}
    >
      <Icon size={15} />
    </button>
  );
}

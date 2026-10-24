import type { RewriteAnswer, RewriteStyle } from "../../../platform/tauri/bindings";

/** The rewrites offered on selected text in the composer, in menu order. */
export const REWRITE_STYLES: { style: RewriteStyle; title: string }[] = [
  { style: "shorter", title: "Shorter" },
  { style: "friendlier", title: "Friendlier" },
  { style: "moreFormal", title: "More formal" },
  { style: "fixGrammar", title: "Fix spelling and grammar" },
];

/**
 * What replaces the selection: one line goes in as plain text, so a few
 * words rewritten mid-sentence stay in their paragraph; more than one
 * (paragraphs, a list) as the HTML Rust made from it.
 */
export function rewriteContent(answer: RewriteAnswer): { type: "text"; text: string } | string {
  return answer.text.includes("\n") ? answer.html : { type: "text", text: answer.text };
}

/** How selected text is read for rewriting: blocks apart by a blank line. */
export const BLOCK_SEPARATOR = "\n\n";

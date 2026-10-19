/**
 * Whether a signature has layout the editor can't keep. The editor (the
 * composer's) handles text, links, colours and web images, which is what
 * Gmail's own signature editor makes; tables (from signature generators)
 * would be flattened.
 */
export function editorWouldSimplify(html: string | null): boolean {
  return html !== null && /<table[\s>]/i.test(html);
}

/** The editor's HTML as a signature: "" when nothing is left in it. */
export function signatureToSave(html: string, text: string): string {
  const hasImage = /<img[\s>]/i.test(html);
  return text.trim() === "" && !hasImage ? "" : html;
}

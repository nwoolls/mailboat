/**
 * Whether keys typed at this target go into a field (text, a contenteditable
 * editor, a select), so the app's single-key shortcuts must leave them alone.
 */
export function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

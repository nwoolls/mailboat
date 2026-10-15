/** What to show after a sign-in attempt fails; nothing if the user cancelled. */
export function signInErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "object" && "kind" in error && error.kind === "cancelled") return null;
  return error instanceof Error ? error.message : String(error);
}

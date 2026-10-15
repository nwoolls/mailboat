import type { AppError } from "./bindings";

export type { AppError };

export class IpcError extends Error {
  readonly kind: string;
  constructor(error: AppError) {
    super(error.message);
    this.kind = error.kind;
  }
}

type Typed<T> = { status: "ok"; data: T } | { status: "error"; error: AppError };

/** Turns a generated command's `{status, data|error}` result into a value or a thrown IpcError. */
export async function unwrap<T>(result: Promise<Typed<T>>): Promise<T> {
  const r = await result;
  if (r.status === "error") throw new IpcError(r.error);
  return r.data;
}

/** True when running inside the Tauri webview (false in Vitest or a plain browser). */
export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

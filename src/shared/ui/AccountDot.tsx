import type { Account } from "../../platform/tauri/bindings";

/** Small colored dot identifying an account in unified views. */
export function AccountDot({
  account,
  size = 8,
}: {
  account: Pick<Account, "color" | "email"> | undefined;
  size?: number;
}) {
  if (!account) return null;
  return (
    <span
      aria-label={account.email}
      title={account.email}
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: account.color }}
    />
  );
}

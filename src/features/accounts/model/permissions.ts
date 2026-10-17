import type { Permission } from "../../../platform/tauri/bindings";

const FEATURES: Record<Permission, string> = {
  contacts: "suggest addresses from Google Contacts",
  calendar: "answer meeting invitations",
  gmailSettings: "manage rules and signatures",
};

/**
 * Why an account should sign in again, or null if its sign-in covers
 * everything: "Sign in again to answer meeting invitations and manage
 * rules and signatures."
 */
export function signInAgainReason(missing: readonly Permission[]): string | null {
  if (missing.length === 0) return null;
  const features = missing.map((p) => FEATURES[p]);
  const list =
    features.length === 1
      ? features[0]
      : `${features.slice(0, -1).join(", ")} and ${features[features.length - 1]}`;
  return `Sign in again so Mailboat can ${list}.`;
}

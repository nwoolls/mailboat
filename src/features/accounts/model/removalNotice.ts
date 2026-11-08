import { APP_NAME } from "../../../shared/lib/brand";

/**
 * What to tell the owner after an account is removed, or null when there is
 * nothing to add. The sign-in couldn't be ended at Google (no connection,
 * or Google refused), so the access stays listed in their Google Account
 * until they remove it there. The cause isn't named: it isn't known.
 */
export function removalNotice(revoked: boolean): string | null {
  if (revoked) return null;
  return `Removed, but ${APP_NAME}'s sign-in couldn't be ended at Google. You can remove its access at myaccount.google.com/permissions.`;
}

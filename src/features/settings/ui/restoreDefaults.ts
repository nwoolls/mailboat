import { resetFeatureFlags } from "../../../shared/lib/featureFlags";
import { composingPrefs } from "../../compose/ui/composingPrefs";
import { emptyToy, lastToy, toyboxStyle } from "../../emptyToys/ui/prefs";
import { listPrefs } from "../../mailbox/ui/listPrefs";
import { viewingPrefs } from "../../mailbox/ui/viewingPrefs";
import { screensaverPrefs } from "../../screensaver/ui/prefs";
import { APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE } from "../model/appearance";
import { textSize } from "./textSize";
import { applyAppearance } from "./useAppearance";

/**
 * Puts every setting kept in this window back to its default (Settings →
 * Advanced → Restore default settings); `settings_defaults` does Rust's.
 * Not reset, as they aren't preferences: pane sizes and which panels show,
 * recent searches, accounts and their colours, per-sender choices, and
 * what lives in Gmail (signatures, rules, the vacation responder).
 */
export function restoreWindowDefaults() {
  viewingPrefs.reset();
  listPrefs.reset();
  composingPrefs.reset();
  textSize.reset();
  screensaverPrefs.reset();
  emptyToy.reset();
  lastToy.reset();
  toyboxStyle.reset();
  resetFeatureFlags();
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(DEFAULT_APPEARANCE));
  applyAppearance(DEFAULT_APPEARANCE);
}

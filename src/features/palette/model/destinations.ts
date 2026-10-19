import type { Account, Label } from "../../../platform/tauri/bindings";
import { pickerName } from "../../mailbox/model/labelPicker";
import {
  ACCOUNT_VIEWS,
  labelSelection,
  type Selection,
  selectionKey,
  UNIFIED_VIEWS,
  viewSelection,
  viewTitle,
} from "../../mailbox/model/views";

/** A place the palette can go: a view, in one account or all of them. */
export type Destination = {
  key: string;
  title: string;
  /** The account's address, shown faint after the title. */
  detail: string | null;
  selection: Selection;
};

/**
 * Every view the sidebar offers, in its order: the unified ones (with
 * more than one account), then each account's views and labels.
 */
export function destinations(accounts: Account[], labels: Label[]): Destination[] {
  const out: Destination[] = [];
  const add = (title: string, detail: string | null, selection: Selection) =>
    out.push({ key: selectionKey(selection), title, detail, selection });
  if (accounts.length > 1)
    for (const view of UNIFIED_VIEWS) {
      add(viewTitle(view), "All accounts", viewSelection(view));
    }
  const detail = (a: Account) => (accounts.length > 1 ? a.email : null);
  for (const account of accounts) {
    for (const view of ACCOUNT_VIEWS)
      add(viewTitle(view), detail(account), viewSelection(view, account.id));
    const own = labels
      .filter((l) => l.accountId === account.id && l.kind === "user")
      .toSorted((a, b) => pickerName(a).localeCompare(pickerName(b)));
    for (const label of own) add(pickerName(label), detail(account), labelSelection(label));
  }
  return out;
}

import { expect, it } from "vitest";
import type { Account, Label } from "../../../platform/tauri/bindings";
import { destinations } from "./destinations";

const account = (id: number, email: string): Account => ({
  id,
  email,
  displayName: null,
  avatarUrl: null,
  color: "#000",
  oauthClient: "default",
});
const label = (id: number, accountId: number, name: string): Label => ({
  id,
  accountId,
  gmailLabelId: `Label_${id}`,
  name,
  kind: "user",
  colorBg: null,
  colorFg: null,
});

it("lists unified views only with several accounts, then each account's views and labels", () => {
  const one = destinations([account(1, "a@x.com")], [label(5, 1, "Work/Acme")]);
  expect(one[0]).toMatchObject({ title: "Inbox", detail: null });
  expect(one.at(-1)).toMatchObject({ title: "Work / Acme" });

  const two = destinations([account(1, "a@x.com"), account(2, "b@y.com")], [label(5, 2, "Bills")]);
  expect(two[0]).toMatchObject({ title: "All Inboxes", detail: "All accounts" });
  expect(two.find((d) => d.title === "Bills")?.detail).toBe("b@y.com");
  expect(new Set(two.map((d) => d.key)).size).toBe(two.length);
});

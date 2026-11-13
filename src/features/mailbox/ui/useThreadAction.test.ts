import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { rollback } from "./useThreadAction";

// Code review: a failed action's rollback wrote the Unread list back after
// the person had left it (and the list had been forgotten), so the next
// visit merged with the old rows.
describe("rollback", () => {
  const key = ["threads", "all|system:unread", { kind: "system", label: "unread" }];

  it("puts the snapshot back into the query it came from", () => {
    const qc = new QueryClient();
    qc.setQueryData(key, "before");
    const query = qc.getQueryCache().find({ queryKey: key, exact: true });
    qc.setQueryData(key, "optimistic");
    rollback(qc, [[key, "before", query]]);
    expect(qc.getQueryData(key)).toBe("before");
  });

  it("leaves a query removed meanwhile gone, and a new one with the same key alone", () => {
    const qc = new QueryClient();
    qc.setQueryData(key, "before");
    const query = qc.getQueryCache().find({ queryKey: key, exact: true });
    qc.removeQueries({ queryKey: key });
    rollback(qc, [[key, "before", query]]);
    expect(qc.getQueryData(key)).toBeUndefined();
    // A new visit made a new query with the same key.
    qc.setQueryData(key, "new visit");
    rollback(qc, [[key, "before", query]]);
    expect(qc.getQueryData(key)).toBe("new visit");
  });
});

import { describe, expect, it } from "vitest";
import { reconcileConversations } from "./conversation-refresh";
import type { Conversation } from "../shared/types";

const row: Conversation = { id: "a", title: "Title", platform: "chatgpt", url: "", updatedAt: 1, messageCount: 2, tags: ["one"] };
describe("directory refresh", () => {
  it("preserves identity after unchanged IndexedDB snapshots", () => {
    const current = [row];
    expect(reconcileConversations(current, structuredClone(current))).toBe(current);
  });
  it("keeps unchanged rows while accepting edits, state changes, deletions and ordering", () => {
    const other = { ...row, id: "b" };
    const current = [row, other];
    const updated = reconcileConversations(current, [{ ...other, hydrationState: "syncing" }, { ...row }]);
    expect(updated[1]).toBe(row);
    expect(updated[0].hydrationState).toBe("syncing");
    expect(reconcileConversations(current, [{ ...row, tags: ["two"] }])[0].tags).toEqual(["two"]);
    expect(reconcileConversations(current, [])).toEqual([]);
  });
});

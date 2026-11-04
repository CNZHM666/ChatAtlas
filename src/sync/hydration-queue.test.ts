import { describe, expect, it } from "vitest";
import type { Conversation } from "../shared/types";
import { orderHydrationQueue } from "./hydration-queue";

describe("hydration priority queue", () => {
  it("prioritizes a clicked conversation, then recent items, without duplicating IDs", () => {
    const now = Date.UTC(2026, 8, 22);
    const rows = [
      { id: "old", sourceUpdatedAt: now - 400 * 86_400_000 },
      { id: "recent", sourceUpdatedAt: now - 2 * 86_400_000 },
      { id: "month", sourceUpdatedAt: now - 45 * 86_400_000 },
    ].map((row) => ({ ...row, platform: "chatgpt", title: row.id, url: row.id, updatedAt: row.sourceUpdatedAt, messageCount: null })) as Conversation[];
    expect(orderHydrationQueue(["old", "recent", "month", "old"], rows, ["old"], now)).toEqual(["old", "recent", "month"]);
  });
});

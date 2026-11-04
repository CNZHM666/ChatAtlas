import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Conversation } from "../shared/types";
import { getDatabase } from "./db";
import { listConversations, saveDiscoveredConversation } from "./conversations";

const row = (id: string, updatedAt: number, sourceUpdatedAt: number): Conversation => ({
  id,
  platform: "chatgpt",
  title: id,
  url: `https://chatgpt.com/c/${id}`,
  updatedAt,
  sourceUpdatedAt,
  messageCount: 1,
  importState: "complete",
});

describe("conversation library chronology", () => {
  beforeEach(async () => { await (await getDatabase()).clear("conversations"); });

  it("orders conversations by their source activity rather than import time", async () => {
    const db = await getDatabase();
    await db.put("conversations", row("older", 9_000, 1_000));
    await db.put("conversations", row("newer", 8_000, 2_000));
    expect((await listConversations()).map((item) => item.id)).toEqual(["newer", "older"]);
  });

  it("updates the source timestamp when a fresh history inventory arrives", async () => {
    await (await getDatabase()).put("conversations", row("existing", 9_000, 1_000));
    await saveDiscoveredConversation(row("existing", 2_000, 3_000));
    expect((await (await getDatabase()).get("conversations", "existing"))?.sourceUpdatedAt).toBe(3_000);
  });

  it("keeps a changed conversation pending until its newer body is persisted", async () => {
    const db = await getDatabase();
    await db.put("conversations", { ...row("pending", 1_000, 1_000), hydrationState: "hydrated" });
    await saveDiscoveredConversation(row("pending", 2_000, 2_000));
    expect(await db.get("conversations", "pending")).toMatchObject({ sourceUpdatedAt: 2_000, hydratedSourceUpdatedAt: 1_000, hydrationState: "queued" });
    await db.put("conversations", { ...(await db.get("conversations", "pending"))!, hydrationState: "failed" });
    await saveDiscoveredConversation(row("pending", 2_000, 2_000));
    expect(await db.get("conversations", "pending")).toMatchObject({ hydratedSourceUpdatedAt: 1_000, hydrationState: "queued" });
  });
});

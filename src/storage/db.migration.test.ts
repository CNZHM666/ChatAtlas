import "fake-indexeddb/auto";
import { openDB } from "idb";
import { expect, it } from "vitest";
it("adds derived stores to version 22 while preserving raw records and existing indexes", async () => {
  const legacy = await openDB("ai-conversation-atlas", 22, { upgrade(db) {
    const messages = db.createObjectStore("messages", { keyPath: "id" }); messages.createIndex("by-conversation", "conversationId"); messages.createIndex("by-updated", "updatedAt");
    db.createObjectStore("conversations", { keyPath: "id" }).createIndex("by-updated", "updatedAt");
    db.createObjectStore("semanticVectors", { keyPath: "id" });
    db.createObjectStore("focusSessions", { keyPath: "id" }).createIndex("by-updated", "updatedAt");
  } });
  const raw = { id: "m", conversationId: "c", content: "原文 buildContext", role: "assistant", updatedAt: 1 };
  const metadata = { id: "c", title: "保留讨论", platform: "claude", updatedAt: 1 };
  await legacy.put("messages", raw); await legacy.put("conversations", metadata); await legacy.put("semanticVectors", { id: "v", values: [1, 0] }); await legacy.put("focusSessions", { id: "old-result", title: "历史项目", updatedAt: 1 }); legacy.close();
  const { getDatabase } = await import("./db"), upgraded = await getDatabase();
  expect(upgraded.version).toBe(24); expect(await upgraded.get("messages", "m")).toEqual(raw); expect(await upgraded.get("conversations", "c")).toEqual(metadata);
  expect(await upgraded.count("discussionHighlights")).toBe(0);
  expect(await upgraded.getAllFromIndex("messages", "by-conversation", "c")).toEqual([raw]); expect([...upgraded.transaction("messages").store.indexNames]).toEqual(["by-conversation", "by-updated"]);
  expect(await upgraded.get("semanticVectors", "v")).toEqual({ id: "v", values: [1, 0] });
  expect(await upgraded.get("focusSessions", "old-result")).toEqual({ id: "old-result", title: "历史项目", updatedAt: 1 });
  expect(await upgraded.count("homeResults")).toBe(0);
  expect(await upgraded.count("messageSearchDocuments")).toBe(0); expect(await upgraded.count("messageSearchManifests")).toBe(0); upgraded.close();
});

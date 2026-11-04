import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { getDatabase } from "./db";
import { linkConversationsToProject } from "./sidecar-links";
import { projectSession } from "../test/project-fixture";
beforeEach(async () => {
  const db = await getDatabase(); for (const name of ["canvases", "conversations", "focusSessions", "messages"] as const) await db.clear(name);
  for (const id of ["a", "b"]) await db.put("conversations", { id, title: id, platform: "chatgpt", url: "", updatedAt: 1, messageCount: 1 });
  await db.put("messages", { id: "original", conversationId: "a", role: "user", content: "untouched", preview: "untouched", messageIndex: 0, contentHash: "same", createdAt: 1, updatedAt: 1 });
  for (const id of ["first", "second"]) { const project = { ...projectSession(), id, canvasId: id }; await db.put("focusSessions", project); await db.put("canvases", { id, name: id, sourceConversationIds: project.sourceConversationIds, createdAt: 1, updatedAt: 1 }); }
});
it("associates one original conversation with multiple projects and deduplicates repeated batches", async () => {
  const db = await getDatabase(), before = await db.get("focusSessions", "first");
  await linkConversationsToProject("first", ["a", "b", "a"]); await linkConversationsToProject("first", ["a", "b"]); await linkConversationsToProject("second", ["a"]);
  const first = await db.get("focusSessions", "first"); expect(first?.sidecarConversationIds).toEqual(["a", "b"]); expect(first?.sourceConversationIds).toEqual(before?.sourceConversationIds); expect(first?.sections).toEqual(before?.sections); expect(first?.sourceSignatures).toEqual(before?.sourceSignatures); expect((await db.get("focusSessions", "second"))?.sidecarConversationIds).toEqual(["a"]); expect(await db.count("messages")).toBe(1); expect((await db.get("messages", "original"))?.content).toBe("untouched");
});
it("rolls back the entire batch if any source is missing", async () => {
  const db = await getDatabase(), before = await db.get("focusSessions", "first"), canvas = await db.get("canvases", "first");
  await expect(linkConversationsToProject("first", ["a", "missing"])).rejects.toThrow(); expect(await db.get("focusSessions", "first")).toEqual(before); expect(await db.get("canvases", "first")).toEqual(canvas);
});
it("does not attach to an unconfirmed preview", async () => {
  const db = await getDatabase(); await db.put("focusSessions", { ...(await db.get("focusSessions", "first"))!, status: "preview" }); await expect(linkConversationsToProject("first", ["a"])).rejects.toThrow(); expect((await db.get("focusSessions", "first"))?.sidecarConversationIds).toBeUndefined();
});

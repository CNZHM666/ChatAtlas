import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDatabase } from "./db";
import { BACKUP_STORES, createAtlasBackup, parseAtlasBackup, restoreAtlasBackup } from "./atlas-backup";
import { listRecentReading, saveReadingProgress } from "./reading-progress";

beforeEach(async () => {
  const db = await getDatabase();
  for (const name of BACKUP_STORES) await db.clear(name);
  await db.clear("aiSettings");
});

describe("local ChatAtlas backup", () => {
  it("round trips personal discussion navigation and accepts backups predating highlights", async () => {
    const db = await getDatabase();
    const edit = { id: JSON.stringify(["c", "m"]), conversationId: "c", messageId: "m", title: "我的重点", category: "我的分类", hidden: true, manual: true, messageIds: ["m"], signatures: { m: "original" }, updatedAt: 2 };
    await db.put("discussionHighlights", edit);
    const backup = await createAtlasBackup(); await db.clear("discussionHighlights");
    await restoreAtlasBackup(backup); expect(await db.get("discussionHighlights", edit.id)).toEqual(edit);
    delete (backup.stores as Partial<typeof backup.stores>).discussionHighlights;
    expect(parseAtlasBackup(JSON.stringify(backup)).stores.discussionHighlights).toEqual([]);
  });
  it("preserves project answers and accepts old backups without question history", async () => {
    const db = await getDatabase();
    await db.put("projectQueryThreads", { id: "project:history", turns: [{ id: "q", question: "Why?", clarification: "Need context", revision: "v1", createdAt: 1, chapters: [] }], updatedAt: 1 });
    const backup = await createAtlasBackup(); await db.clear("projectQueryThreads"); await restoreAtlasBackup(backup);
    expect((await db.get("projectQueryThreads", "project:history"))?.turns[0].question).toBe("Why?");
    delete (backup.stores as Partial<typeof backup.stores>).projectQueryThreads;
    expect(parseAtlasBackup(JSON.stringify(backup)).stores.projectQueryThreads).toEqual([]);
  });
  it("round trips knowledge, conversations and reading position without exporting API credentials", async () => {
    const db = await getDatabase();
    await db.put("canvases", { id: "space", name: "Control", title: "Control", readingPathCardIds: ["card"], createdAt: 1, updatedAt: 1 });
    await db.put("knowledgeCards", { id: "card", type: "concept", title: "Poles", notes: "I understood stability", tags: [], origin: "user", userEdited: true, createdAt: 1, updatedAt: 1 });
    await db.put("conversations", { id: "conversation", title: "Control theory", platform: "chatgpt", url: "", messageCount: 1, updatedAt: 1 });
    await db.put("messages", { id: "message", conversationId: "conversation", messageIndex: 0, role: "user", content: "Why are poles stable?", preview: "Why are poles stable?", contentHash: "hash", createdAt: 1, updatedAt: 1 });
    await saveReadingProgress({ canvasId: "space", cardId: "card", messageId: "message", scrollTop: 500 });
    await db.put("reviewMarks", { id: "mark", cardId: "card", canvasId: "space", conversationId: "conversation", messageId: "message", kind: "conclusion", originalText: "Why are poles stable?", updateNote: "Later update", createdAt: 1, updatedAt: 2 });
    await db.put("aiSettings", { id: "ai-settings", mode: "byok", provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "secret", model: "test", updatedAt: 1 });

    await db.put("projectHistoryTasks", { id: "history:transient", signature: "request", scopeSignature: "scope", status: "pending", results: { batch: { events: [] } }, updatedAt: 1 });
    const backup = await createAtlasBackup();
    expect(backup.stores).not.toHaveProperty("projectHistoryTasks");
    const serialized = JSON.stringify(backup);
    expect(serialized).toContain("Why are poles stable?");
    expect(serialized).not.toContain("secret");
    await db.clear("conversations");
    await db.clear("readingProgress");
    await db.put("transcriptIndexes", { id: "conversation", fingerprint: "stale", passages: [] });
    await restoreAtlasBackup(parseAtlasBackup(serialized));

    expect((await db.get("canvases", "space"))?.readingPathCardIds).toEqual(["card"]);
    expect((await db.get("knowledgeCards", "card"))?.notes).toBe("I understood stability");
    expect((await db.get("messages", "message"))?.content).toBe("Why are poles stable?");
    expect((await listRecentReading())[0]).toMatchObject({ cardId: "card", messageId: "message", scrollTop: 500 });
    expect((await db.get("reviewMarks", "mark"))?.updateNote).toBe("Later update");
    expect(await db.get("transcriptIndexes", "conversation")).toBeUndefined();
    expect(await db.get("projectHistoryTasks", "history:transient")).toBeUndefined();
    expect((await db.get("aiSettings", "ai-settings"))?.apiKey).toBe("secret");
  });

  it("rejects a missing store before changing local data", async () => {
    const db = await getDatabase();
    await db.put("canvases", { id: "keep", name: "Keep", createdAt: 1, updatedAt: 1 });
    const malformed = await createAtlasBackup();
    delete (malformed.stores as Partial<typeof malformed.stores>).messages;
    expect(() => parseAtlasBackup(JSON.stringify(malformed))).toThrow();
    expect((await db.get("canvases", "keep"))?.name).toBe("Keep");
  });
});

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import { getConversation } from "../storage/conversations";
import { getMessagesForConversation } from "../storage/messages";
import { importChatGPTExport } from "./export-import";
import { normalizeHistoryConversation, normalizeHistoryItem } from "./chatgpt-normalizer";
import { historyImportStatus, startHistoryImport, type HistoryAdapter } from "./import-runner";
import { loadTranscriptPassages, queueTranscriptIndexRefresh } from "../search/transcript-index";
import { ChatGPTExportAdapter } from "./chatgpt-export-adapter";

vi.mock("../search/transcript-index", async (original) => ({ ...await original<typeof import("../search/transcript-index")>(), queueTranscriptIndexRefresh: vi.fn() }));

function exportFile(records: unknown[], name = "conversations.json"): File {
  return { name, text: async () => JSON.stringify(records) } as File;
}

function record(id: string, updateTime = 1_700_000_000, body = "Hello") {
  return { id, title: `Conversation ${id}`, create_time: updateTime - 20, update_time: updateTime, current_node: `${id}-m1`, mapping: { [`${id}-m1`]: { id: `${id}-m1`, parent: null, message: { id: `${id}-m1`, author: { role: "user" }, content: { parts: [body] }, create_time: updateTime } } } };
}

describe("official ChatGPT JSON bulk import", () => {
  beforeEach(async () => {
    const db = await getDatabase();
    await db.clear("conversations");
    await db.clear("messages");
    await db.clear("importJobs");
    await db.clear("transcriptIndexes");
    vi.mocked(queueTranscriptIndexRefresh).mockClear();
  });

  it("imports locally, then skips identical records without duplicating messages", async () => {
    const file = exportFile([record("a"), record("b")]);
    expect(await importChatGPTExport(file)).toMatchObject({ scanned: 2, added: 2, updated: 0, unchanged: 0, failed: 0, importedIds: ["a", "b"] });
    expect(await importChatGPTExport(file)).toMatchObject({ scanned: 2, added: 0, updated: 0, unchanged: 2, failed: 0, importedIds: ["a", "b"] });
    expect((await getMessagesForConversation("a")).map((message) => message.content)).toEqual(["Hello"]);
    expect((await getConversation("a"))?.source).toBe("chatgpt_export");
  });

  it("does not schedule background full-text work for bulk imports, while on-demand search still works", async () => {
    await importChatGPTExport(exportFile([record("lazy-index", 1_700_000_000, "All original text remains searchable.")]));
    expect(queueTranscriptIndexRefresh).not.toHaveBeenCalled();
    expect(await (await getDatabase()).count("transcriptIndexes")).toBe(0);
    const source = (await getConversation("lazy-index"))!;
    expect((await loadTranscriptPassages([source])).passages[0].text).toBe("All original text remains searchable.");
    expect(await (await getDatabase()).count("transcriptIndexes")).toBe(1);
  });

  it("updates one changed conversation and isolates a malformed sibling", async () => {
    await importChatGPTExport(exportFile([record("a")]));
    const result = await importChatGPTExport(exportFile([record("a", 1_700_000_100, "New body"), { title: "Missing ID" }, record("c")]));
    expect(result).toMatchObject({ scanned: 3, added: 1, updated: 1, unchanged: 0, failed: 1 });
    expect((await getMessagesForConversation("a")).map((message) => message.content)).toEqual(["New body"]);
    expect((await getMessagesForConversation("c")).map((message) => message.content)).toEqual(["Hello"]);
  });

  it("detects edited text with the same timestamp, branch and message count, and skips normalizing identical exports", async () => {
    await importChatGPTExport(exportFile([record("edited")]));
    const normalize = vi.spyOn(ChatGPTExportAdapter.prototype, "normalizeConversation");
    try {
      const changed = exportFile([record("edited", 1_700_000_000, "Corrected condition")]);
      expect(await importChatGPTExport(changed)).toMatchObject({ updated: 1, unchanged: 0, failed: 0 });
      expect((await getMessagesForConversation("edited"))[0].content).toBe("Corrected condition");
      expect(await importChatGPTExport(changed)).toMatchObject({ updated: 0, unchanged: 1 });
      expect(normalize).toHaveBeenCalledOnce();
    } finally { normalize.mockRestore(); }
  });

  it("does not trust live metadata alone, or replace saved text with an empty/malformed export", async () => {
    await importChatGPTExport(exportFile([record("live")]));
    const db = await getDatabase(), saved = (await getConversation("live"))!;
    await db.put("conversations", { ...saved, source: "chatgpt_live", sourceRevision: undefined });
    expect(await importChatGPTExport(exportFile([record("live", 1_700_000_000, "Export correction")]))).toMatchObject({ updated: 1, unchanged: 0 });
    const empty = { ...record("live", 1_700_000_100), mapping: {} };
    const malformed = { ...record("live", 1_700_000_100), mapping: [] };
    expect(await importChatGPTExport(exportFile([empty, malformed]))).toMatchObject({ failed: 2, updated: 0 });
    expect((await getMessagesForConversation("live"))[0].content).toBe("Export correction");
  });

  it("does not rewrite an unchanged undated export or roll back to an older export", async () => {
    const undated = { ...record("undated"), create_time: undefined, update_time: undefined };
    expect((await importChatGPTExport(exportFile([undated]))).added).toBe(1);
    expect((await importChatGPTExport(exportFile([undated]))).unchanged).toBe(1);
    await importChatGPTExport(exportFile([record("dated", 1_700_000_100, "Current")]));
    expect((await importChatGPTExport(exportFile([record("dated", 1_700_000_000, "Old")]))).unchanged).toBe(1);
    expect((await getMessagesForConversation("dated"))[0].content).toBe("Current");
  });

  it("does not erase existing data when the chosen JSON file is invalid", async () => {
    await importChatGPTExport(exportFile([record("a")]));
    await expect(importChatGPTExport({ name: "conversations.json", text: async () => "not-json" } as File)).rejects.toThrow("valid JSON");
    expect(await getMessagesForConversation("a")).toHaveLength(1);
  });

  it("uses a 127-conversation export as the base and live-syncs only three new IDs", async () => {
    const exported = Array.from({ length: 127 }, (_, index) => record(`bulk-${index}`));
    expect((await importChatGPTExport(exportFile(exported))).added).toBe(127);
    const latest = [...exported, ...Array.from({ length: 3 }, (_, index) => record(`fresh-${index}`))];
    const metadata = latest.map((raw) => normalizeHistoryItem(raw)!);
    const fetch = vi.fn(async (id: string) => normalizeHistoryConversation(latest.find((raw) => raw.id === id)!));
    const adapter: HistoryAdapter = { isAvailable: async () => true, list: async (_offset, _limit, archived) => ({ conversations: archived ? [] : metadata, hasMore: false }), getConversation: fetch };
    await startHistoryImport(adapter, "incremental");
    await vi.waitFor(async () => expect(await historyImportStatus()).toMatchObject({ status: "completed", discovered: 130, hydrated: 130 }), { timeout: 15_000 });
    expect(fetch.mock.calls.map(([id]) => id).sort()).toEqual(["fresh-0", "fresh-1", "fresh-2"]);
    expect(queueTranscriptIndexRefresh).not.toHaveBeenCalled();
  }, 20_000);
});

import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import type { ConversationMessage } from "../shared/types";
import { MessageFullTextSearch } from "./message-fulltext";

const message = (id: string, content: string): ConversationMessage => ({ id, content, conversationId: "c", role: "assistant", preview: "", contentHash: "external", messageIndex: 0, createdAt: 1, updatedAt: 1 });
beforeEach(async () => {
  const db = await getDatabase();
  for (const store of ["messages", "conversations", "messageSearchDocuments", "messageSearchManifests", "messageSearchState"] as const) await db.clear(store);
  await db.put("conversations", { id: "c", title: "记录", platform: "chatgpt", url: "", updatedAt: 1, messageCount: 1 });
});

it("recalls prose queries without requiring their filler, while preserving identifiers and topic coverage", async () => {
  const db = await getDatabase();
  const corpus = [
    ["electrical", "建立电气验证体系，确认接线约束。"],
    ["memory", "采用本地向量检索实现跨平台上下文。"],
    ["code", "async function buildContext(request: ContextRequest) { return GPIO_pin; }"],
    ["mixed", "使用 React 实现上下文管理和 BYOK 适配器。"],
    ["noise", "本地天气，项目回顾，电路图。"],
  ];
  for (const [id, text] of corpus) await db.put("messages", message(id, text));
  const engine = new MessageFullTextSearch();
  const cases = [
    ["如何做电气验证", "electrical"], ["请帮我查找之前关于本地向量检索的讨论", "memory"],
    ["how to find buildContext", "code"], ["GPIO_pin", "code"], ["上下文 React BYOK", "mixed"],
  ];
  for (const [query, id] of cases) expect((await engine.search(query)).hits.map(hit => hit.messageId), query).toEqual([id]);
  expect((await engine.search("buildContex")).hits).toEqual([]);
  expect((await engine.search("本地电气验证")).hits).toEqual([]);
  console.info("ATLAS_LEXICAL_QUALITY", JSON.stringify({ curatedQueries: cases.length, recallAt10: 1, precisionAt10: 1, scope: "small regression corpus, not semantic-search evaluation" }));
});

it("combines distant chunks in one message and never merges separate messages", async () => {
  const db = await getDatabase();
  await db.put("messages", message("whole", `alpha ${"background ".repeat(800)} omega`));
  await db.put("messages", message("left", "alpha")); await db.put("messages", message("right", "omega"));
  const result = await new MessageFullTextSearch().search("alpha omega");
  expect(result.hits.map(hit => hit.messageId)).toEqual(["whole"]);
  expect(result.hits[0].message.content.slice(result.hits[0].sourceRange.start, result.hits[0].sourceRange.end)).toMatch(/alpha|omega/u);
});

it("matches quoted phrases across chunk seams but never across source fields", async () => {
  const db = await getDatabase();
  await db.put("messages", message("phrase", `${" ".repeat(3997)}final decision accepted`));
  await db.put("messages", message("separate", "final decision not yet accepted"));
  await db.put("messages", { ...message("fields", "final"), uiParts: [{ ordinal: 0, raw: "{}", fallbackText: "decision" }] });
  const engine = new MessageFullTextSearch();
  expect((await engine.search('"final decision"')).hits.map(hit => hit.messageId).sort()).toEqual(["phrase", "separate"]);
  expect((await engine.search('"decision accepted"')).hits.map(hit => hit.messageId)).toEqual(["phrase"]);
});

it("retains UI coordinates, original Unicode offsets, and prototype-like message IDs", async () => {
  const db = await getDatabase();
  await db.put("messages", { ...message("__proto__", "intro"), uiParts: [{ ordinal: 0, raw: "{}", fallbackText: "component UIKeyword" }] });
  const content = "😀 前提\n\nＢＹＯＫ 架构";
  await db.put("messages", message("constructor", content));
  const engine = new MessageFullTextSearch();
  expect((await engine.search("UIKeyword")).hits[0].sourceRange).toMatchObject({ part: "ui", partIndex: 0, start: 10, end: 19, excerpt: "UIKeyword" });
  const result = (await engine.search("BYOK")).hits[0];
  expect(result.messageId).toBe("constructor");
  expect(content.slice(result.sourceRange.start, result.sourceRange.end)).toBe("ＢＹＯＫ");
});

it("keeps a healthy generation searchable until rebuilt data is committed", async () => {
  const db = await getDatabase(); await db.put("messages", message("one", "stableKeyword"));
  const engine = new MessageFullTextSearch(); await engine.prepare(); const old = (await engine.status()).active;
  const put = db.put.bind(db);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), waiting = new Promise<void>(resolve => { entered = resolve; });
  const spy = vi.spyOn(db, "put").mockImplementation((async (store: string, value: { active?: string; building?: unknown }) => {
    if (store === "messageSearchState" && value.active !== old && !value.building) { entered(); await gate; }
    return put(store as never, value as never);
  }) as typeof db.put);
  const rebuilding = engine.rebuild();
  try {
    await waiting;
    const result = await engine.search("stableKeyword");
    expect(result.hits.map(hit => hit.messageId)).toEqual(["one"]);
    expect((await engine.status()).active).toBe(old);
  } finally { release(); await rebuilding; spy.mockRestore(); await engine.settleMaintenance(); }
  expect((await engine.status()).active).not.toBe(old);
});

it("does not publish a generation aborted during final reconciliation", async () => {
  const db = await getDatabase(); await db.put("messages", message("one", "abortSafe"));
  const engine = new MessageFullTextSearch(); await engine.prepare(); const old = (await engine.status()).active;
  const controller = new AbortController();
  await expect(engine.rebuild({ signal: controller.signal, onProgress: value => { if (value.phase === "reconciling") controller.abort(); } })).rejects.toThrow();
  expect((await engine.status()).active).toBe(old);
  expect((await db.get("messages", "one"))?.content).toBe("abortSafe");
  await engine.settleMaintenance();
});

it("labels paginated totals as a snapshot and returns stable distinct message pages", async () => {
  const db = await getDatabase(); for (let n = 0; n < 45; n++) await db.put("messages", message(`row-${n}`, "commonKeyword"));
  const engine = new MessageFullTextSearch();
  const first = await engine.search("commonKeyword", { limit: 10 }), second = await engine.search("commonKeyword", { limit: 10, offset: 10 });
  expect(first).toMatchObject({ total: 45, totalExact: false });
  expect(new Set([...first.hits, ...second.hits].map(hit => hit.messageId)).size).toBe(20);
  expect((await engine.search("commonKeyword", { limit: 100 })).totalExact).toBe(true);
});

it("repairs a missed warm-process event in background after the safety-check interval", async () => {
  const db = await getDatabase(); await db.put("messages", message("old", "existingKeyword"));
  const engine = new MessageFullTextSearch(); await engine.prepare();
  await db.put("messages", message("missed", "newKeyword"));
  const now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now + 31000);
  try {
    expect((await engine.search("existingKeyword")).hits.map(hit => hit.messageId)).toEqual(["old"]);
    await engine.settleMaintenance();
    expect((await engine.search("newKeyword")).hits.map(hit => hit.messageId)).toEqual(["missed"]);
  } finally { clock.mockRestore(); }
});

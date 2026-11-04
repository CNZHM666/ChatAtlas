import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationMessage } from "../shared/types";
import type { FocusSession } from "../shared/focus-session";
import { getDatabase } from "../storage/db";
import { invalidateStoredMessageSearchIndex } from "../storage/messages";
import { searchAnswers, searchReviewSections } from "./review-search";
import { searchScore } from "./query";

const message = (id: string, index: number, content: string): ConversationMessage => ({ id, messageIndex: index, content, conversationId: "source", role: index % 2 ? "assistant" : "user", preview: content, contentHash: id, createdAt: 1, updatedAt: 1 });
beforeEach(async () => { await (await getDatabase()).clear("messages"); invalidateStoredMessageSearchIndex(); });
describe("finding remembered meaning", () => {
  it("matches Chinese concepts and common paraphrases while ranking exact wording higher", () => {
    expect(searchScore("费用", "先确定预算再采购", true)).toBeGreaterThan(0);
    expect(searchScore("费用", "费用需要先确认", true)).toBeGreaterThan(searchScore("费用", "先确定预算再采购", true));
    expect(searchScore("降低模型成本", "模型成本与来源复用", true)).toBeGreaterThan(0);
    expect(searchScore("费用", "稳定性实验", true)).toBe(0);
  });
  it("groups several matching answers under their actual question and keeps the matching message anchor", async () => {
    const db = await getDatabase();
    for (const item of [message("q1", 0, "怎样验证方案？"), message("a1", 1, "先核对预算。"), { ...message("a2", 2, "预算确认以后再验证。"), role: "assistant" as const }, message("q2", 4, "预算是什么？")]) await db.put("messages", item);
    const fetch = vi.spyOn(globalThis, "fetch");
    const results = await searchAnswers("预算", []);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ kind: "message", title: "怎样验证方案？", questionId: "q1", message: { id: "a1" } });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
  it("finds a chapter and its own note separately with precise resume targets", () => {
    const session = { id: "review", title: "Project", sections: [{ id: "chapter", title: "验证前提", body: "先控制预算。", transition: "再验证" }], sectionNotes: { chapter: { text: "我理解了费用的边界" } } } as unknown as FocusSession;
    const results = searchReviewSections("费用", [session]);
    expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "section", sessionId: "review", sectionId: "chapter" }), expect.objectContaining({ kind: "note", sessionId: "review", sectionId: "chapter" })]));
  });
  it("rebuilds search after a changed source so old answers cannot persist in the index", async () => {
    const db = await getDatabase();
    await db.put("messages", message("q", 0, "Old answer"));
    expect(await searchAnswers("Old answer", [])).toHaveLength(1);
    await db.put("messages", message("q", 0, "New condition"));
    invalidateStoredMessageSearchIndex();
    expect(await searchAnswers("Old answer", [])).toHaveLength(0);
    expect(await searchAnswers("New condition", [])).toHaveLength(1);
  });
});

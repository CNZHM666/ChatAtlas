import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { getDatabase } from "../storage/db";
import { MessageFullTextSearch } from "./message-fulltext";
import { matchesNearbyQuery, planMessageQuery } from "./message-query";
import { findHistory, historyRequest } from "./home-history";
import { invalidateStoredMessageSearchIndex } from "../storage/messages";

beforeEach(async () => { const db = await getDatabase(); await db.clear("messages"); await db.clear("conversations"); invalidateStoredMessageSearchIndex(); });
it("requires topic words in the same local passage, allowing Chinese, identifiers and mixed language", () => {
  expect(matchesNearbyQuery(planMessageQuery("自动化学习"), ["自动化专业的学习路线"], 120)).toBe(true);
  expect(matchesNearbyQuery(planMessageQuery("自动化学习"), ["自动化作业" + "无关文字".repeat(80) + "学习建议"], 120)).toBe(false);
  expect(matchesNearbyQuery(planMessageQuery("React buildContext"), ["React 调用 buildContext"], 120)).toBe(true);
  expect(matchesNearbyQuery(planMessageQuery("自动化学习"), ["自动化", "学习"], 120)).toBe(false);
});
it("does not treat a matching conversation title or distant words as message evidence", async () => {
  const db = await getDatabase();
  const sources = ["relevant", "distant", "title"].map(id => ({ id, title: id === "title" ? "自动化学习" : id, platform: "chatgpt", url: "", updatedAt: 1, messageCount: 1 }));
  for (const source of sources) await db.put("conversations", source);
  for (const [id, content] of [["relevant", "自动化专业的学习路线应先巩固控制理论。"], ["distant", "自动化作业" + "无关文字".repeat(100) + "学习建议"], ["title", "文章润色与字数统计"]]) await db.put("messages", { id, conversationId: id, role: "assistant", messageIndex: 0, content, contentHash: "", preview: "", createdAt: 1, updatedAt: 1 });
  const engine = new MessageFullTextSearch();
  expect((await engine.search("自动化学习", { requireBodyMatch: true, proximity: 120 })).hits.map(hit => hit.messageId)).toEqual(["relevant"]);
  // General library search retains its existing title and whole-message behavior.
  expect((await engine.search("自动化学习")).hits).toHaveLength(3);
  const result = await findHistory(historyRequest("我想找回我之前有关自动化学习的对话").query, sources);
  expect(result.matches.flatMap(match => match.messages.map(message => message.id))).toEqual(["relevant"]);
});
it("locates a real topic near the end rather than an unrelated first chunk with the same title", async () => {
  const db = await getDatabase(); await db.put("conversations", { id: "long", title: "自动化学习", platform: "chatgpt", url: "", updatedAt: 1, messageCount: 1 });
  const content = "一般讨论。".repeat(1200) + "自动化专业学习路线";
  await db.put("messages", { id: "long-message", conversationId: "long", role: "assistant", messageIndex: 0, content, contentHash: "", preview: "", createdAt: 1, updatedAt: 1 });
  const result = await new MessageFullTextSearch().search("自动化学习", { requireBodyMatch: true, proximity: 120 });
  expect(result.hits[0].sourceRange.start).toBeGreaterThan(5000); expect(result.hits[0].summary).toContain("自动化专业学习路线");
});

import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { getDatabase } from "../storage/db";
import { invalidateStoredMessageSearchIndex } from "../storage/messages";
import { discoverHistory, findHistory, historyRequest, historySearchMatcher } from "./home-history";
import type { Conversation } from "../shared/types";
import { analyzedVersion } from "../ai/conversation-profiler";
const source: Conversation = { id: "hardware", title: "硬件平台", platform: "claude", url: "https://claude.ai/chat/hardware", updatedAt: 1, messageCount: 2, importState: "complete", hydrationState: "hydrated" };
beforeEach(async () => { await (await getDatabase()).clear("messages"); invalidateStoredMessageSearchIndex(); });
it("recognizes the four intents without turning a keyword into a project", () => {
  expect(historyRequest("硬件")).toEqual({ intent: "find", query: "硬件" });
  expect(historyRequest("我之前在哪里讨论过 Python-control 的 PR？").intent).toBe("find");
  expect(historyRequest("我之前关于硬件 AI 的讨论有哪些重要决定？")).toEqual({ intent: "summarize", query: "硬件 AI" });
  expect(historyRequest("帮我把所有关于硬件平台开发的对话整理成一个项目")).toEqual({ intent: "project", query: "硬件平台开发" });
  expect(historyRequest("根据之前的 NumPy 学习记录，帮我复习广播机制。")).toEqual({ intent: "review", query: "NumPy" });
  expect(historyRequest("之前我们选择的本地向量检索方案是什么？").intent).toBe("summarize");
});
it("searches imported originals only and removes platform markup from result excerpts", async () => {
  const db = await getDatabase();
  for (const id of [source.id, "unavailable"]) await db.put("messages", { id, conversationId: id, role: "assistant", content: "Orama 本地向量检索url资料turn3search1", preview: "Orama", messageIndex: 1, contentHash: id, createdAt: 1, updatedAt: 1 });
  const result = await findHistory("Orama", [source]);
  expect(result.matches).toHaveLength(1); expect(result.matches[0].messages).toHaveLength(1);
  expect(result.matches[0].excerpt).toContain("资料"); expect(result.matches[0].excerpt).not.toContain("turn3");
});
it("uses real source groups, rejects outdated analysis and never creates a project", () => {
  const sources = [source, { ...source, id: "other", title: "另一条硬件讨论" }];
  const profiles = sources.map(item => ({ conversationId: item.id, summary: "", domains: [], topics: ["硬件平台设计"], concepts: [], intent: "产品开发", evidenceRefs: [], analyzedVersion: analyzedVersion(item), analysisSource: "ai" as const, updatedAt: 1 }));
  expect(discoverHistory(sources, profiles)).toEqual([{ title: "硬件平台设计", kind: "project", sourceIds: ["hardware", "other"], basis: "analysis" }]);
  expect(discoverHistory(sources, profiles.map(item => ({ ...item, analyzedVersion: "old" })))).toEqual([]);
  expect(discoverHistory([source], profiles)).toEqual([]);
});

it("presents a complete shared title phrase instead of a four-character matching fragment", () => {
  const sources = ["戒色小程序推广优化", "戒色小程序功能规划", "完善戒色小程序体验"].map((title, index) => ({ ...source, id: `topic-${index}`, title }));
  expect(discoverHistory(sources, [])).toEqual([{ title: "戒色小程序", kind: "project", sourceIds: sources.map(item => item.id), basis: "titles" }]);
  expect(discoverHistory(["新版海报设计需求", "新版海报设计修改"].map((title, index) => ({ ...source, id: `poster-${index}`, title })), [])[0].title).toBe("新版海报设计");
});

it("extracts a personal project topic and excludes unrelated generic project discussions", async () => {
  const request = historyRequest("我想完成我的戒色项目");
  expect(request).toEqual({ intent: "find", query: "戒色" });
  const sources = [{ ...source, id: "target", title: "戒色小程序推广优化" }, { ...source, id: "other", title: "AI对话项目总览" }];
  const db = await getDatabase();
  await db.put("messages", { id: "noise", conversationId: "other", role: "assistant", content: "我想完成我的硬件项目，创建一个项目工作台", preview: "", messageIndex: 0, contentHash: "noise", createdAt: 1, updatedAt: 1 });
  expect((await findHistory(request.query, sources)).matches.map(row => row.conversation.id)).toEqual(["target"]);
  expect(historySearchMatcher("Python-control PR")("讨论 React PR 的项目")).toBe(0);
  expect(historySearchMatcher("Python-control PR")("Python-control project structure")).toBe(0);
  expect(historySearchMatcher("Python-control PR")("Python-control 的 PR 修复")).toBeGreaterThan(0);
  expect(historySearchMatcher("本地向量检索")("本地部署，项目检索和学习")).toBe(0);
});

it("filters unavailable sources before the result cap and cleans markdown noise in excerpts", async () => {
  const db = await getDatabase();
  const message = { role: "assistant" as const, content: "=====\n## 戒色项目\n**确定**使用小程序。", preview: "", messageIndex: 0, contentHash: "test", createdAt: 1, updatedAt: 1 };
  for (let index = 0; index < 181; index++) await db.put("messages", { ...message, id: `excluded-${index}`, conversationId: "excluded" });
  await db.put("messages", { ...message, id: "kept", conversationId: source.id });
  const result = await findHistory("戒色", [source]);
  expect(result.matches).toHaveLength(1); expect(result.capped).toBe(false);
  expect(result.matches[0].excerpt).toContain("确定使用小程序");
  expect(result.matches[0].excerpt).not.toMatch(/=|#|\*/u);
});

it("rejects generic activity names and partial Chinese words as project suggestions", () => {
  const sources = ["海报设计要求", "图标设计要求", "小程序设计说明", "小程序设备调试", "实验代码优化", "实验代码修改"].map((title, index) => ({ ...source, id: `generic-${index}`, title }));
  const found = discoverHistory(sources, []);
  expect(found.map(item => item.title)).not.toContain("设计要求");
  expect(found.map(item => item.title)).not.toContain("实验代码");
  expect(found.map(item => item.title)).not.toContain("小程序设");
});

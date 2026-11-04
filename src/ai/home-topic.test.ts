import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { groundedHomeQueries, homeTopic, homeTopicMatches, explicitAllHomeSources } from "./home-topic";
import { planHomeTask, retrieveHomeTask } from "./home-task";
import type { AtlasAIProvider, StructuredAIRequest } from "./provider";
import { getDatabase } from "../storage/db";
import { invalidateStoredMessageSearchIndex } from "../storage/messages";
const pool = ["hardware", "habit"].map(id => ({ id, title: id === "hardware" ? "硬件 AI 平台" : "分析戒色 AI 留存", platform: "chatgpt", url: "", updatedAt: id === "habit" ? 999 : 1, messageCount: 1, importState: "complete" as const, hydrationState: "hydrated" as const }));
beforeEach(async () => { const db = await getDatabase(); await db.clear("messages"); await db.clear("conversations"); for (const source of pool) await db.put("conversations", source); invalidateStoredMessageSearchIndex(); });
it("locks the original domain across generic AI queries, translations and relative follow-ups", () => {
  const topic = homeTopic("我之前讨论的有关硬件AI的对话");
  expect(homeTopicMatches(topic, "戒色 AI 产品留存")).toBe(false);
  expect(homeTopicMatches(topic, "Hardware AI uses GPIO")).toBe(true);
  expect(groundedHomeQueries("硬件AI", ["AI 产品留存", "戒色AI", "Hardware AI"])).toEqual(["硬件AI", "Hardware AI"]);
  expect(homeTopic("硬件AI\n追问：那具体怎么做？").anchors).toEqual(homeTopic("硬件AI").anchors);
  expect(homeTopicMatches(homeTopic("GPIO"), "一般硬件讨论")).toBe(false);
});
it("does not permit a model to turn a topical question into all selected material", async () => {
  const provider = { generateStructured: async (request: StructuredAIRequest<unknown>) => request.validate({ action: "answer", queries: ["AI 产品"], allSources: true }) } as AtlasAIProvider;
  const plan = await planHomeTask(provider, "硬件AI", pool, [], true, new AbortController().signal);
  expect(plan.allSources).toBeUndefined(); expect(plan.queries).toEqual(["硬件AI"]);
  expect(explicitAllHomeSources("完整整理全部已选对话", 132)).toBe(true);
});
it("never chooses the latest unrelated conversation when the requested subject has no evidence", async () => {
  await (await getDatabase()).put("messages", { id: "habit-1", conversationId: "habit", role: "assistant", content: "戒色 AI 日活和用户留存方案。", messageIndex: 0, contentHash: "", preview: "", createdAt: 1, updatedAt: 1 });
  const provider = { generateStructured: vi.fn(async (request: StructuredAIRequest<unknown>) => request.validate({ ids: ["turn1"], queries: ["戒色AI"] })) } as unknown as AtlasAIProvider;
  const result = await retrieveHomeTask({ action: "answer", queries: ["AI 产品留存"] }, pool, new AbortController().signal, { provider, goal: "硬件AI", zh: true });
  expect(result.ids).toEqual([]); expect(provider.generateStructured).not.toHaveBeenCalled();
});
it("removes unrelated turns even inside a matching conversation and binds selections to original quotations", async () => {
  const db = await getDatabase();
  for (const [index, content] of ["硬件AI 使用 GPIO 做电气校验。", "午餐吃什么？", "使用米饭和蔬菜。"].entries()) await db.put("messages", { id: `m-${index}`, conversationId: "hardware", role: index === 2 ? "assistant" : "user", content, messageIndex: index, contentHash: "", preview: "", createdAt: 1, updatedAt: 1 });
  const provider = { generateStructured: async (request: StructuredAIRequest<unknown>) => { const data = JSON.parse(request.prompt); return request.validate({ ids: data.turns.map((item: {id: string}) => item.id) }); } } as AtlasAIProvider;
  const result = await retrieveHomeTask({ action: "answer", queries: ["硬件AI"] }, pool, new AbortController().signal, { provider, goal: "硬件AI", zh: true });
  expect(result.scope.blocks?.flatMap(block => block.messageIds)).toEqual(["m-0"]);
  const invalid = { generateStructured: async (request: StructuredAIRequest<unknown>) => request.validate({ matches: [{ id: "turn1", quote: "产品已经全面上线", reason: "相关", relation: "direct" }] }) } as AtlasAIProvider;
  await expect(retrieveHomeTask({ action: "answer", queries: ["硬件AI"] }, pool, new AbortController().signal, { provider: invalid, goal: "硬件AI", zh: true })).rejects.toThrow();
});

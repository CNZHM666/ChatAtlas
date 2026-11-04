import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import type { Conversation, ConversationMessage } from "../shared/types";
import type { AtlasAIProvider, StructuredAIRequest } from "./provider";
import { recommendKnowledgeSourcesWithAI, retrieveKnowledgeSources } from "./knowledge-source-retrieval";

const conversation = (id: string, title = "Python 使用笔记"): Conversation => ({ id, title, platform: "chatgpt", url: "", messageCount: 40, importState: "complete", updatedAt: 1 });
const message = (id: string, index: number, content: string): ConversationMessage => ({ id: `${id}-${index}`, conversationId: id, messageIndex: index, role: index % 2 ? "assistant" : "user", content, preview: "", contentHash: content, createdAt: 1, updatedAt: 1 });
function model(matches: Array<{ id: string; relevance: string; reason: string }> = [], queries: string[] = []): AtlasAIProvider {
  const generateStructured = vi.fn(async <T>(request: StructuredAIRequest<T>): Promise<T> => request.validate(request.taskType === "other" ? { queries } : { matches })) as unknown as AtlasAIProvider["generateStructured"];
  return { testConnection: async () => ({ ok: true, model: "test" }), generateStructured };
}

beforeEach(async () => {
  const db = await getDatabase();
  for (const store of ["messages", "conversations", "semanticProfiles", "questionSnapshots", "conversationGraphs", "semanticVectors"] as const) await db.clear(store);
});

describe("source retrieval from full conversations", () => {
  it("retains an exact match in the middle and tail of a long answer even when the LLM omits it", async () => {
    const db = await getDatabase();
    const target = conversation("middle");
    await db.put("messages", message(target.id, 19, `${"安装环境及版本说明。".repeat(300)}控制理论中的状态空间如何描述动态系统？`));
    const sources = [...Array.from({ length: 55 }, (_, index) => conversation(`noise-${index}`, "控制理论目录")), target];
    const provider = model();
    const ranked = await recommendKnowledgeSourcesWithAI("控制理论", sources, provider);
    const found = ranked.find((item) => item.conversation.id === target.id);
    expect(found?.relevance).toBe("possible");
    expect(found?.evidence?.[0]).toMatchObject({ messageId: "middle-19", messageIndex: 19 });
    expect(found?.evidence?.[0].excerpt).toContain("控制理论中的状态空间");
    expect(vi.mocked(provider.generateStructured).mock.calls.some(([request]) => request.taskType === "source_retrieval" && request.prompt.includes("控制理论中的状态空间"))).toBe(true);
    const manual = await retrieveKnowledgeSources("动态系统", [target]);
    expect(manual[0].evidence?.[0].excerpt).toContain("动态系统");
  });

  it("uses vectors even with plenty of keyword matches and reuses cached passage vectors", async () => {
    const db = await getDatabase();
    const target = conversation("semantic", "python-control 实践");
    const sources = [target, ...Array.from({ length: 5 }, (_, index) => conversation(`keyword-${index}`, "控制理论"))];
    await db.put("messages", message(target.id, 22, "Why do poles determine whether the state-space system is stable?"));
    const embedBatch = vi.fn(async (texts: string[]) => texts.map((text) => text.includes("poles") ? [1, 0] : [0, 1]));
    const embedding = { modelKey: "integration-vector", embedBatch, embedText: vi.fn(async () => [1, 0]) };
    const provider = model([{ id: target.id, relevance: "high", reason: "通过系统极点讨论稳定性" }]);
    const first = await recommendKnowledgeSourcesWithAI("控制理论", sources, provider, embedding);
    expect(first[0].conversation.id).toBe(target.id);
    expect(first[0].evidence?.[0].excerpt).toContain("poles");
    const count = embedBatch.mock.calls.length;
    await recommendKnowledgeSourcesWithAI("控制理论", sources, provider, embedding);
    expect(embedBatch).toHaveBeenCalledTimes(count);
    await recommendKnowledgeSourcesWithAI("控制理论", [target], provider, embedding);
    expect((await db.getAll("semanticVectors")).some((item) => item.id.includes("keyword-4"))).toBe(true);
    await db.put("messages", message(target.id, 22, "Why do poles determine stability after changing the feedback?"));
    target.updatedAt = 2;
    await recommendKnowledgeSourcesWithAI("控制理论", [target], provider, embedding);
    expect(embedBatch).toHaveBeenCalledTimes(count + 1);
    expect(embedBatch.mock.calls.at(-1)?.[0]).toHaveLength(1);
  });

  it("uses specific query expansion to find a different-language discussion without embeddings", async () => {
    const db = await getDatabase();
    const target = conversation("expanded", "Python control");
    await db.put("messages", message(target.id, 30, "How does a state-space model represent the system?"));
    const provider = model([], ["state-space", "状态空间"]);
    const sources = [...Array.from({ length: 60 }, (_, index) => conversation(`unrelated-${index}`, "Python 安装")), target];
    const ranked = await recommendKnowledgeSourcesWithAI("控制理论", sources, provider);
    expect(ranked[0].conversation.id).toBe(target.id);
    expect(ranked[0].relevance).toBe("possible");
    expect(ranked[0].evidence?.[0].excerpt).toContain("state-space");
    expect(ranked.filter((item) => item.relevance !== "other")).toHaveLength(1);
  });

  it("keeps local evidence when AI is unavailable and propagates cancellation", async () => {
    const db = await getDatabase();
    const target = conversation("offline");
    await db.put("messages", message(target.id, 16, "控制理论中反馈如何改变系统？"));
    const provider: AtlasAIProvider = { testConnection: async () => ({ ok: true, model: "test" }), generateStructured: async () => { throw new Error("offline"); } };
    const onProgress = vi.fn();
    const ranked = await recommendKnowledgeSourcesWithAI("控制理论", [target], provider, null, { onProgress });
    expect(ranked[0].relevance).toBe("possible");
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ stage: "done", rankingUnavailable: true }));
    const controller = new AbortController();
    controller.abort();
    await expect(recommendKnowledgeSourcesWithAI("控制理论", [target], provider, null, { signal: controller.signal })).rejects.toThrow();
  });
});

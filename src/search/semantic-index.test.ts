// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationGraph, ConversationSemanticProfile } from "../shared/types";
import { getDatabase } from "../storage/db";
import { rawSemanticDocuments, searchCachedVectors, refreshSemanticVectorsForConversations, searchSemanticArtifacts, semanticDocuments, semanticIndexRebuildRequired } from "./semantic-index";

afterEach(() => vi.unstubAllGlobals());

const conversation: Conversation = { id: "semantic-control", platform: "chatgpt", title: "控制理论", url: "", updatedAt: 1, messageCount: 4 };
const profile: ConversationSemanticProfile = { conversationId: conversation.id, title: conversation.title, summary: "状态空间", domains: [], topics: [], concepts: ["系统极点"], intent: "学习", evidenceRefs: [], analyzedVersion: "1", updatedAt: 1 };

describe("local semantic index", () => {
  it("retrieves paraphrases only from cached in-scope originals without building document vectors on query", async () => {
    const documents = rawSemanticDocuments([{ id: "one", conversationId: "scoped", content: "BYOK lowers the operating cost" }, { id: "outside", conversationId: "excluded", content: "BYOK outside the project" }]);
    const embedBatch = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]));
    const embedText = vi.fn(async () => [1, 0]);
    const embedding = { modelKey: `raw-query:${crypto.randomUUID()}`, embedBatch, embedText };
    expect(await searchCachedVectors("Who pays for API calls?", documents, embedding)).toEqual([]);
    expect(embedText).not.toHaveBeenCalled(); expect(embedBatch).not.toHaveBeenCalled();
    await searchSemanticArtifacts("seed", documents, 2, embedding, 64, { allowNewModel: true });
    embedBatch.mockClear(); embedText.mockClear();
    const hits = await searchCachedVectors("Who pays for API calls?", documents.slice(0, 1), embedding);
    expect(hits.map(hit => hit.conversationId)).toEqual(["scoped"]);
    await searchCachedVectors("Who pays for API calls?", documents.slice(0, 1), embedding);
    expect(embedText).toHaveBeenCalledOnce(); expect(embedBatch).not.toHaveBeenCalled();
    expect(await searchCachedVectors("changed", [{ ...documents[0], body: "New decision" }], embedding)).toEqual([]);
    expect(embedText).toHaveBeenCalledOnce();
    const db = await getDatabase();
    for (const row of await db.getAll("semanticVectors")) if (row.modelKey === embedding.modelKey) await db.delete("semanticVectors", row.id);
  });
  it("retrieves an episode by a Chinese technical term and removes stale documents", async () => {
    const graph: ConversationGraph = { conversationId: conversation.id, nodes: [], edges: [], updatedAt: 1, chapters: [{ id: "chapter-control", conversationId: conversation.id, title: "稳定性", questionIds: ["conversation-message-q1"], order: 0, collapsed: true, source: "auto", createdAt: 1, updatedAt: 1 }], episodes: [{ id: "episode-poles", chapterId: "chapter-control", conversationId: conversation.id, title: "A矩阵与系统极点", summary: "特征值决定连续系统的稳定性", concepts: ["系统极点"], questionIds: ["q1"], messageIds: ["q1", "a1"] }] };
    const documents = semanticDocuments([conversation], [profile], [graph]);
    expect((await searchSemanticArtifacts("系统极点", documents)).some((hit) => hit.episodeId === "episode-poles")).toBe(true);
    expect((await searchSemanticArtifacts("系统极点", [])).some((hit) => hit.conversationId === conversation.id)).toBe(false);
  });
  it("uses cached episode embeddings for later hybrid searches", async () => {
    let embeddedBatches = 0;
    const embedding = {
      modelKey: "test:hybrid:episode",
      embedBatch: async (texts: string[]) => { embeddedBatches++; return texts.map((value) => value.includes("系统极点") ? [1, 0] : [0, 1]); },
      embedText: async () => [1, 0],
    };
    const documents = semanticDocuments([conversation], [profile], [{ conversationId: conversation.id, nodes: [], edges: [], updatedAt: 1, episodes: [{ id: "episode-vector", chapterId: "chapter-control", conversationId: conversation.id, title: "系统极点", summary: "动力系统分析", questionIds: ["q1"], messageIds: ["q1", "a1"] }] }]);
    const hits = await searchSemanticArtifacts("control dynamics", documents, 10, embedding);
    expect(hits.some((hit) => hit.episodeId === "episode-vector")).toBe(true);
    const firstBatchCount = embeddedBatches;
    await searchSemanticArtifacts("control dynamics", documents, 10, embedding);
    expect(embeddedBatches).toBe(firstBatchCount);
  });
  it("embeds only new and revised artifacts after a proposal is applied", async () => {
    const db = await getDatabase();
    const local = { ...conversation, id: "background-vector-refresh" };
    const graph: ConversationGraph = { conversationId: local.id, nodes: [], edges: [], updatedAt: 1, episodes: [{ id: "background-episode", chapterId: "chapter", conversationId: local.id, title: "极点", summary: "系统稳定性", questionIds: ["q1"], messageIds: ["q1", "a1"] }] };
    await db.put("conversations", local);
    await db.put("semanticProfiles", { ...profile, conversationId: local.id });
    await db.put("conversationGraphs", graph);
    await db.put("aiSettings", { id: "ai-settings", provider: "openai", baseUrl: "https://atlas-vector-test.invalid/v1", apiKey: "test", model: "chat", embeddingModel: "vector", updatedAt: 1 });
    const batches: string[][] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const input = (JSON.parse(String(init.body)) as { input: string[] }).input;
      batches.push(input);
      return { ok: true, json: async () => ({ data: input.map((_, index) => ({ index, embedding: [1, index + 1] })) }) };
    }));
    const previousVectors = await db.getAll("semanticVectors");
    if (previousVectors.length) {
      expect(await semanticIndexRebuildRequired({ modelKey: "openai:https://atlas-vector-test.invalid/v1:vector:1", embedText: async () => [], embedBatch: async () => [] })).toBe(true);
      await refreshSemanticVectorsForConversations([local.id]);
      expect(batches).toHaveLength(0);
    }
    await refreshSemanticVectorsForConversations([local.id], true);
    await refreshSemanticVectorsForConversations([local.id]);
    expect(batches.map((batch) => batch.length)).toEqual([2]);
    await db.put("conversationGraphs", { ...graph, episodes: [{ ...graph.episodes![0], summary: "改过的系统稳定性" }] });
    await Promise.all([refreshSemanticVectorsForConversations([local.id]), refreshSemanticVectorsForConversations([local.id])]);
    expect(batches.map((batch) => batch.length)).toEqual([2, 1]);
    await db.delete("conversationGraphs", local.id);
    await refreshSemanticVectorsForConversations([local.id]);
    expect((await db.getAll("semanticVectors")).some((item) => item.id.endsWith(`episode:${local.id}:background-episode`))).toBe(false);
    expect(batches.map((batch) => batch.length)).toEqual([2, 1]);
  });
});

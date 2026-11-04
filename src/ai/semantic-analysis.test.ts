import { requestBudget } from "./request-policy";
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationMessage } from "../shared/types";
import { getDatabase } from "../storage/db";
import { ensureSemanticArtifacts } from "./semantic-analysis";
import { analyzedVersion, ANALYSIS_VERSION } from "./conversation-profiler";
import { buildKnowledgeProposal } from "./proposal-builder";
import type { AtlasAIProvider, StructuredAIRequest } from "./provider";

const conversation = (id: string, updatedAt = 1): Conversation => ({ id, platform: "chatgpt", title: `Python control ${id}`, url: `https://chatgpt.com/c/${id}`, messageCount: 1, updatedAt });
const message = (id: string): ConversationMessage => ({ id: `${id}-q`, conversationId: id, messageIndex: 0, role: "user", content: "How does Python NumPy help control systems?", preview: "Python NumPy control", contentHash: `${id}-hash`, createdAt: 1, updatedAt: 1 });
const completeResponse = <T>(request: StructuredAIRequest<T>): T => {
  const payload = JSON.parse(request.prompt) as { questions?: Array<{ questionId: string; question: string }>; conversations?: Array<{ id: string }> };
  return request.validate(payload.questions ? { snapshots: payload.questions.map((question) => ({ questionId: question.questionId, displayTitle: "控制系统问题", summary: question.question, concepts: ["控制系统"], intent: "学习" })) } : { profiles: payload.conversations?.map((item) => ({ conversationId: item.id, summary: "讨论控制系统", domains: ["控制与自动化"], concepts: ["控制系统"] })) });
};

describe("versioned semantic cache", () => {
  it("keeps local fallback concepts focused on the question topic", async () => {
    const selected = conversation("local-concepts");
    const source = { ...message(selected.id), content: "请帮我解释什么是矩阵特征值？", contentHash: "local-concepts-hash" };
    const result = await ensureSemanticArtifacts({ conversations: [selected], loadMessages: async () => [source], includeProfiles: false, now: 3999 });
    expect(result.snapshots[0].displayTitle).toContain("矩阵特征值");
    expect(result.snapshots[0].concepts).toContain("矩阵特征值");
    expect(result.snapshots[0].concepts).not.toContain("请帮我");
  });
  it("blocks an explicit AI task when a provider returns incomplete question analysis", async () => {
    const selected = conversation("semantic-required-ai");
    const provider: AtlasAIProvider = { id: "test", modelId: "one", testConnection: async () => ({ ok: true, model: "one" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => request.validate({ snapshots: [] }) };
    await expect(ensureSemanticArtifacts({ conversations: [selected], loadMessages: async (id) => [message(id)], provider, includeProfiles: false, requireAI: true, now: 4000 })).rejects.toThrow("incomplete question analysis");
  });

  it("keeps unmarked legacy profiles without triggering a full paid reanalysis", async () => {
    const selected = conversation("semantic-legacy-cache");
    await (await getDatabase()).put("semanticProfiles", { conversationId: selected.id, summary: "已有的知识摘要", domains: ["编程与开源"], topics: [], concepts: ["Python"], intent: "学习", questionCount: 1, evidenceRefs: [], analysisVersion: ANALYSIS_VERSION, analyzedVersion: analyzedVersion(selected), updatedAt: 1 });
    const loadMessages = vi.fn(async (id: string) => [message(id)]);
    const generateStructured = vi.fn();
    const result = await ensureSemanticArtifacts({ conversations: [selected], loadMessages, provider: { id: "test", modelId: "one", testConnection: async () => ({ ok: true, model: "one" }), generateStructured }, now: 19 });
    expect(result.diagnostics.cachedQuestionsReused).toBe(1);
    expect(loadMessages).not.toHaveBeenCalled();
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("skips AI planning when selected conversations are unchanged and already linked", async () => {
    const selected = conversation("semantic-already-organized");
    const loadMessages = vi.fn(async (id: string) => [message(id)]);
    await ensureSemanticArtifacts({ conversations: [selected], loadMessages, provider: { id: "test", modelId: "one", testConnection: async () => ({ ok: true, model: "one" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => completeResponse(request) }, now: 20 });
    await (await getDatabase()).put("knowledgeCards", { id: "existing-card", type: "concept", title: "Python", tags: [], origin: "ai", userEdited: false, createdAt: 20, updatedAt: 20 });
    await (await getDatabase()).put("sourceRelations", { id: "semantic-source", cardId: "existing-card", sourceType: "conversation", sourceId: selected.id, conversationId: selected.id, createdAt: 20 });
    const generateStructured = vi.fn();
    const proposal = await buildKnowledgeProposal({ conversations: [selected], loadMessages, existingCanvases: [], provider: { id: "test", modelId: "one", testConnection: async () => ({ ok: true, model: "one" }), generateStructured }, now: 21 });
    expect(loadMessages).toHaveBeenCalledOnce();
    expect(generateStructured).not.toHaveBeenCalled();
    expect(proposal.cards).toHaveLength(0);
    expect(proposal.sources).toHaveLength(0);
  });
  it("reopens 127 cached conversations without loading raw messages, then analyzes only three new ones", async () => {
    const initial = Array.from({ length: 127 }, (_, index) => conversation(`semantic-batch-${index}`));
    const loadMessages = vi.fn(async (id: string) => [message(id)]);
    const first = await ensureSemanticArtifacts({ conversations: initial, loadMessages, now: 10 });
    expect(first.profiles).toHaveLength(127);
    expect(first.diagnostics.rawMessagesLoaded).toBe(127);
    expect(first.diagnostics.questionsAnalyzed).toBe(127);
    loadMessages.mockClear();

    const reopened = await ensureSemanticArtifacts({ conversations: initial, loadMessages, now: 11 });
    expect(loadMessages).not.toHaveBeenCalled();
    expect(reopened.diagnostics.cachedQuestionsReused).toBe(127);
    expect(reopened.diagnostics.rawMessagesLoaded).toBe(0);

    const additions = Array.from({ length: 3 }, (_, index) => conversation(`semantic-new-${index}`));
    const incremental = await ensureSemanticArtifacts({ conversations: [...initial, ...additions], loadMessages, now: 12 });
    expect(loadMessages).toHaveBeenCalledTimes(3);
    expect(incremental.freshConversationIds).toEqual(additions.map((item) => item.id));
    expect(incremental.diagnostics.questionsAnalyzed).toBe(3);
  });

  it("batches short questions across conversations without losing their sources", async () => {
    const conversations = Array.from({ length: 25 }, (_, index) => conversation(`cross-batch-${index}`));
    const requests: Array<{ taskType?: string; questions?: Array<{ conversationId: string; questionId: string }> }> = [];
    const provider: AtlasAIProvider = { id: "test", modelId: "one", testConnection: async () => ({ ok: true, model: "one" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      requests.push({ taskType: request.taskType, ...JSON.parse(request.prompt) as { questions?: Array<{ conversationId: string; questionId: string }> } });
      return completeResponse(request);
    } };
    const result = await ensureSemanticArtifacts({ conversations, loadMessages: async (id) => [message(id)], provider, now: 1000 });
    const extraction = requests.filter((request) => request.taskType === "question_snapshot");
    expect(extraction).toHaveLength(3);
    expect(extraction.map((request) => request.questions?.length)).toEqual([12, 12, 1]);
    expect(extraction.flatMap((request) => request.questions ?? []).map((question) => question.conversationId)).toEqual(conversations.map((item) => item.id));
    expect(result.profiles).toHaveLength(25);
    expect(result.snapshots.every((snapshot) => snapshot.analysisSource === "ai")).toBe(true);
    expect(result.diagnostics.questionsAnalyzed).toBe(25);
  });

  it("samples a long conversation for intent-led knowledge analysis and reuses its profile", async () => {
    const id = "intent-long-90";
    const selected = { ...conversation(id), messageCount: 90 };
    const messages = Array.from({ length: 90 }, (_, index) => ({ ...message(id), id: `${id}-q-${index}`, messageIndex: index, content: `Control theory question ${index}`, contentHash: `${id}-hash-${index}` }));
    const loadMessages = vi.fn(async () => messages);
    const requestTypes: string[] = [];
    const provider: AtlasAIProvider = { id: "test", modelId: "one", testConnection: async () => ({ ok: true, model: "one" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => { requestTypes.push(request.taskType ?? "other"); return completeResponse(request); } };
    const first = await ensureSemanticArtifacts({ conversations: [selected], loadMessages, provider, preferCachedArtifacts: true, requireAI: true, now: 5000 });
    expect(first.snapshots).toHaveLength(90);
    expect(first.diagnostics.questionsAnalyzed).toBe(12);
    expect(requestTypes.filter((type) => type === "question_snapshot")).toHaveLength(1);
    expect(first.profiles[0].analysisSource).toBe("ai");
    requestTypes.length = 0;
    loadMessages.mockClear();
    const second = await ensureSemanticArtifacts({ conversations: [selected], loadMessages, provider, preferCachedArtifacts: true, requireAI: true, now: 5001 });
    expect(second.diagnostics.cachedQuestionsReused).toBe(90);
    expect(loadMessages).not.toHaveBeenCalled();
    expect(requestTypes).toHaveLength(0);
  });

  it("retries only the missing conversation after a partial cross-conversation batch", async () => {
    const conversations = Array.from({ length: 3 }, (_, index) => conversation(`cross-partial-${index}`));
    const batches: string[][] = [];
    const provider: AtlasAIProvider = { id: "test", modelId: "one", testConnection: async () => ({ ok: true, model: "one" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      const payload = JSON.parse(request.prompt) as { questions?: Array<{ conversationId: string; questionId: string; question: string }> };
      if (!payload.questions) return completeResponse(request);
      batches.push(payload.questions.map((item) => item.conversationId));
      const returned = batches.length === 1 ? payload.questions.slice(0, 2) : payload.questions;
      return request.validate({ snapshots: returned.map((item) => ({ conversationId: item.conversationId, questionId: item.questionId, displayTitle: "控制系统问题", summary: item.question, concepts: ["控制系统"] })) });
    } };
    await ensureSemanticArtifacts({ conversations, loadMessages: async (id) => [message(id)], provider, now: 1010 });
    const rawLoads: string[] = [];
    await ensureSemanticArtifacts({ conversations, loadMessages: async (id) => { rawLoads.push(id); return [message(id)]; }, provider, now: 1011 });
    expect(batches).toEqual([conversations.map((item) => item.id), [conversations[2].id]]);
    expect(rawLoads).toEqual([conversations[2].id]);
  });

  it("reuses an unchanged question snapshot when conversation metadata changes", async () => {
    const loadMessages = vi.fn(async (id: string) => [message(id)]);
    const original = conversation("semantic-versioned", 1);
    await ensureSemanticArtifacts({ conversations: [original], loadMessages, now: 13 });
    const changed = await ensureSemanticArtifacts({ conversations: [conversation(original.id, 2)], loadMessages, now: 14 });
    expect(changed.diagnostics.questionsAnalyzed).toBe(0);
    expect(changed.diagnostics.cachedQuestionsReused).toBe(1);
    expect((await (await getDatabase()).get("semanticProfiles", original.id))?.analysisVersion).toBe(1);
  });

  it("bounds long prompts and samples the whole conversation, including the end", async () => {
    const id = "semantic-long-sampling";
    const prompts: Array<Record<string, unknown>> = [];
    const provider: AtlasAIProvider = {
      testConnection: async () => ({ ok: true, model: "test" }),
      generateStructured: async <T>(request: StructuredAIRequest<T>) => {
        const payload = JSON.parse(request.prompt) as Record<string, unknown>;
        prompts.push(payload);
        return request.validate("questions" in payload ? { snapshots: [] } : { profiles: [] });
      },
    };
    const messages: ConversationMessage[] = Array.from({ length: 30 }, (_, index) => ({
      ...message(id), id: `${id}-q-${index}`, messageIndex: index, content: `${index === 29 ? "Last topic in the conversation" : `Question ${index}`} ${"a".repeat(1700)} TAIL_MARKER`, contentHash: `long-${index}`,
    }));
    await ensureSemanticArtifacts({ conversations: [{ ...conversation(id), messageCount: messages.length }], loadMessages: async () => messages, provider, mode: "fast", now: 15 });
    const extraction = prompts.filter((payload) => Array.isArray(payload.questions) && !payload.conversations);
    expect(extraction.length).toBeGreaterThan(1);
    for (const payload of extraction) {
      const questions = payload.questions as Array<{ question: string; answer: string }>;
      expect(questions.length).toBeLessThanOrEqual(12);
      expect(questions.every((item) => item.question.length <= 3500 && item.question.includes("TAIL_MARKER"))).toBe(true);
      const budget = requestBudget({ taskType: "question_snapshot", system: "", prompt: JSON.stringify(payload) });
      expect(budget.inputTokens).toBeLessThanOrEqual(budget.maxInputTokens);
    }
    const profile = prompts.find((payload) => Array.isArray(payload.conversations));
    const sampled = (profile?.conversations as Array<{ questions: Array<{ title: string }> }>)[0].questions;
    expect(sampled).toHaveLength(12);
    expect(sampled.at(-1)?.title).toContain("Last topic");
  });
  it.each([10, 40, 100])("keeps %i-question analysis batched and the second pass free of provider calls", async (count) => {
    const id = `cost-regression-${count}`;
    const prompts: string[] = [];
    const provider: AtlasAIProvider = {
      testConnection: async () => ({ ok: true, model: "test" }),
      generateStructured: async <T>(request: StructuredAIRequest<T>) => {
        prompts.push(request.prompt);
        return completeResponse(request);
      },
    };
    const messages = Array.from({ length: count }, (_, index) => ({ ...message(id), id: `${id}-${index}`, messageIndex: index, content: `Question ${index} about control systems`, contentHash: `hash-${index}` }));
    const loadMessages = vi.fn(async () => messages);
    const selected = { ...conversation(id), messageCount: count };
    const first = await ensureSemanticArtifacts({ conversations: [selected], loadMessages, provider, now: count * 100 });
    const extraction = prompts.filter((prompt) => "questions" in JSON.parse(prompt));
    expect(first.diagnostics.questionsAnalyzed).toBe(count);
    expect(extraction.length).toBe(Math.ceil(count / 12));
    expect(extraction.every((prompt) => prompt.length < 6000)).toBe(true);
    expect(prompts.length).toBeLessThanOrEqual(Math.ceil(count / 12) + 1);
    prompts.length = 0;
    loadMessages.mockClear();
    const second = await ensureSemanticArtifacts({ conversations: [selected], loadMessages, provider, now: count * 100 + 1 });
    expect(second.diagnostics.cachedQuestionsReused).toBe(count);
    expect(loadMessages).not.toHaveBeenCalled();
    expect(prompts).toHaveLength(0);
  });

  it("retries incomplete AI extraction instead of treating fallback snapshots as completed analysis", async () => {
    const selected = conversation("semantic-incomplete-ai");
    let calls = 0;
    const provider: AtlasAIProvider = { id: "test", modelId: "one", testConnection: async () => ({ ok: true, model: "one" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => { calls += 1; return request.validate("questions" in JSON.parse(request.prompt) ? { snapshots: [] } : { profiles: [] }); } };
    const first = await ensureSemanticArtifacts({ conversations: [selected], loadMessages: async (id) => [message(id)], provider, now: 3000 });
    const second = await ensureSemanticArtifacts({ conversations: [selected], loadMessages: async (id) => [message(id)], provider, now: 3001 });
    expect(first.snapshots[0].analysisSource).toBe("fallback");
    expect(second.diagnostics.cachedQuestionsReused).toBe(0);
    expect(calls).toBe(4);
  });

  it("retries only the missing question after a partial AI response", async () => {
    const selected = { ...conversation("semantic-partial-ai"), messageCount: 2 };
    const messages = [message(selected.id), { ...message(selected.id), id: `${selected.id}-q2`, messageIndex: 2, content: "How are system poles calculated?", contentHash: "second-hash" }];
    const questionBatches: string[][] = [];
    const provider: AtlasAIProvider = { id: "test", modelId: "one", testConnection: async () => ({ ok: true, model: "one" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      const payload = JSON.parse(request.prompt) as { questions?: Array<{ questionId: string; question: string }> };
      if (!payload.questions) return request.validate({ profiles: [{ conversationId: selected.id, summary: "控制系统计算", domains: ["控制与自动化"], concepts: ["系统极点"] }] });
      questionBatches.push(payload.questions.map((question) => question.questionId));
      const returned = questionBatches.length === 1 ? payload.questions.slice(0, 1) : payload.questions;
      return request.validate({ snapshots: returned.map((question) => ({ questionId: question.questionId, displayTitle: "控制系统问题", summary: question.question, concepts: ["系统极点"] })) });
    } };
    await ensureSemanticArtifacts({ conversations: [selected], loadMessages: async () => messages, provider, now: 3050 });
    const second = await ensureSemanticArtifacts({ conversations: [selected], loadMessages: async () => messages, provider, now: 3051 });
    expect(questionBatches).toEqual([[messages[0].id, messages[1].id], [messages[1].id]]);
    expect(second.diagnostics.cachedQuestionsReused).toBe(1);
    expect((await (await getDatabase()).get("semanticProfiles", selected.id))?.analysisSource).toBe("ai");
  });

  it("skips conversation profiling when only the conversation canvas needs question snapshots", async () => {
    const selected = conversation("semantic-snapshots-only");
    const requests: string[] = [];
    const provider: AtlasAIProvider = { id: "test", modelId: "one", testConnection: async () => ({ ok: true, model: "one" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      requests.push(request.taskType ?? "other");
      return request.validate({ snapshots: [{ questionId: `${selected.id}-q`, summary: "控制系统中的 NumPy 用法", displayTitle: "NumPy 控制计算", concepts: ["NumPy"], intent: "学习" }] });
    } };
    const result = await ensureSemanticArtifacts({ conversations: [selected], loadMessages: async (id) => [message(id)], provider, includeProfiles: false, now: 3100 });
    expect(requests).toEqual(["question_snapshot"]);
    expect(result.profiles).toHaveLength(0);
    expect(await (await getDatabase()).get("semanticProfiles", selected.id)).toBeUndefined();
  });
  it("analyzes only three additions when a hundred conversations are cached", async () => {
    const existing = Array.from({ length: 100 }, (_, index) => conversation(`cost-existing-${index}`));
    await ensureSemanticArtifacts({ conversations: existing, loadMessages: async (id) => [message(id)], provider: { id: "test", modelId: "one", testConnection: async () => ({ ok: true, model: "one" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => completeResponse(request) }, now: 2000 });
    const additions = Array.from({ length: 3 }, (_, index) => conversation(`cost-added-${index}`));
    const rawLoads: string[] = [];
    const prompts: string[] = [];
    const provider: AtlasAIProvider = { id: "test", modelId: "one", testConnection: async () => ({ ok: true, model: "one" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      prompts.push(request.prompt);
      return completeResponse(request);
    } };
    const result = await ensureSemanticArtifacts({ conversations: [...existing, ...additions], loadMessages: async (id) => { rawLoads.push(id); return [message(id)]; }, provider, now: 2001 });
    expect(rawLoads).toEqual(additions.map((item) => item.id));
    expect(result.freshConversationIds).toEqual(additions.map((item) => item.id));
    expect(result.diagnostics.questionsAnalyzed).toBe(3);
    expect(prompts).toHaveLength(2);
    expect(prompts.every((prompt) => !prompt.includes("cost-existing-"))).toBe(true);
  });
});

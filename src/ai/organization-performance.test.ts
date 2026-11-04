import { atlasApiClient, DemoApiError, ServerProxyLLMProvider } from "./demo-api";
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeBatches } from "./batch-executor";
import { compactRequest } from "./compact-request";
import { splitDiscussion } from "./discussion-segments";
import { createAtlasAI, createAtlasAIFromProvider } from "./atlas-ai";
import { listAIUsage } from "../storage/ai-usage";
import { estimateTokens } from "../shared/atlas/policy.js";
import { incrementalChapterPrefix } from "./incremental-chapters";
import { planLongConversation } from "./chapter-batches";
import { ensureSemanticArtifacts } from "./semantic-analysis";
import { localSnapshot } from "./semantic-analysis";
import { organizationLatency, analyzeOrganizationRuns } from "./usage-analysis";
import { AIProviderHttpError, type AtlasAIProvider, type StructuredAIRequest } from "./provider";
import type { AISettings, ConversationGraph, ConversationMessage, QuestionSnapshot } from "../shared/types";

const settings: AISettings = { id: "ai-settings", mode: "byok", provider: "deepseek", baseUrl: "https://example.com/v1", apiKey: "test", model: "main", updatedAt: 1 };
const provider: AtlasAIProvider = { capabilities: { textGeneration: true, structuredOutput: "json", embeddings: false, maxConcurrency: 3 }, testConnection: async () => ({ ok: true, model: "test" }), generateStructured: async (request) => request.validate({}) };
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("bounded organization concurrency", () => {
  it("overlaps independent work but returns source order and never exceeds three requests", async () => {
    let active = 0; let maximum = 0;
    const finishes: number[] = [];
    const results = await executeBatches([40, 15, 2, 4, 3], provider, async (ms, index) => {
      maximum = Math.max(maximum, ++active); await delay(ms); active--; finishes.push(index); return index;
    });
    expect(maximum).toBe(3); expect(active).toBe(0);
    expect(finishes[0]).toBe(2); expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it("stops scheduling on failure and waits for successful in-flight checkpoints", async () => {
    const started: number[] = []; const saved: number[] = [];
    const run = executeBatches([0, 1, 2, 3, 4], provider, async (item) => {
      started.push(item); await delay(item === 1 ? 1 : 10);
      if (item === 1) throw Error("failed"); saved.push(item);
    });
    await expect(run).rejects.toThrow("failed");
    expect(started).toEqual([0, 1, 2]); expect(saved.sort()).toEqual([0, 2]);
  });

  it("honors cancellation and drains active work without scheduling remaining items", async () => {
    const controller = new AbortController(); const started: number[] = [];
    const run = executeBatches([0, 1, 2, 3, 4], provider, async (item) => {
      started.push(item); await delay(5); controller.abort();
    }, controller.signal);
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(started).toEqual([0, 1, 2]);
  });

  it("reduces the scheduling limit after an explicit rate limit", async () => {
    let attempts = 0;
    const raw: AtlasAIProvider = { ...provider, capabilities: { ...provider.capabilities!, requestUsage: true }, generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      if (!attempts++) throw new AIProviderHttpError(429, "limited", 0);
      request.onUsage?.({ inputTokens: 1, outputTokens: 1 }); return request.validate({ ok: true });
    } };
    const ai = createAtlasAIFromProvider(raw, settings);
    await ai.extract({ system: "", prompt: crypto.randomUUID(), validate: (value) => value });
    expect(ai.capabilities.maxConcurrency).toBe(1);
  });
});

describe("request receipts and compact wire format", () => {
  it("keeps hosted actual and pending costs attached to their own concurrent receipt", async () => {
    vi.spyOn(atlasApiClient, "getSession").mockResolvedValue({ token: "test", expiresAt: new Date(Date.now() + 60000).toISOString(), features: { asyncTasks: true, conversationStructure: true, compactOrganization: true }, embedding: { modelKey: "test", dimensions: 2 } });
    vi.spyOn(atlasApiClient, "runTask").mockImplementation(async (_task, data) => {
      const label = (data.questions as Array<{ question: string }>)[0].question;
      await delay(label === "slow" ? 20 : 1);
      if (label === "timeout") throw new DemoApiError("PROVIDER_TIMEOUT", 504, { inputTokens: 0, outputTokens: 0, costCny: 0, pendingCostCny: .07, modelId: "hosted-main" }, "pending-id");
      return { result: { ok: true }, usage: { inputTokens: 11, outputTokens: 3, costCny: .012, pendingCostCny: 0, modelId: "hosted-economy" }, requestId: "confirmed-id" };
    });
    const runId = crypto.randomUUID();
    const ai = createAtlasAIFromProvider(new ServerProxyLLMProvider(), settings, undefined, runId);
    await Promise.allSettled(["slow", "timeout"].map((question) => ai.extract({ taskType: "question_snapshot", system: "", prompt: JSON.stringify({ questions: [{ questionId: crypto.randomUUID(), question }] }), validate: (value) => value })));
    const events = (await listAIUsage()).filter((event) => event.runId === runId);
    expect(events).toHaveLength(2);
    expect(events.find((event) => event.requestId === "confirmed-id")).toMatchObject({ inputTokens: 11, outputTokens: 3, costCny: .012, pendingCostCny: 0, modelId: "hosted-economy" });
    expect(events.find((event) => event.requestId === "pending-id")).toMatchObject({ inputTokens: 0, outputTokens: 0, costCny: 0, pendingCostCny: .07, modelId: "hosted-main" });
  });

  it("records concurrent provider receipts independently, including a rejected truncated output", async () => {
    const runId = crypto.randomUUID();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const input = JSON.parse(String(init.body)).messages[1].content as string;
      const slow = input.includes("slow");
      await delay(slow ? 25 : 2);
      return new Response(JSON.stringify({ id: slow ? "slow-id" : "failed-id", model: "actual-model", choices: [{ message: { content: '{"ok":true}' }, finish_reason: slow ? "stop" : "length" }], usage: { prompt_tokens: slow ? 111 : 22, completion_tokens: slow ? 33 : 4 } }));
    }));
    const ai = createAtlasAI(settings, undefined, runId);
    const outcomes = await Promise.allSettled(["slow", "truncated"].map((label) => ai.extract({ system: "", prompt: `${label}-${runId}`, validate: (value) => value })));
    expect(outcomes.map((item) => item.status)).toEqual(["fulfilled", "rejected"]);
    const events = (await listAIUsage()).filter((event) => event.runId === runId);
    expect(events).toHaveLength(2);
    expect(events.find((event) => event.requestId === "slow-id")).toMatchObject({ inputTokens: 111, outputTokens: 33, status: "completed", modelId: "actual-model" });
    expect(events.find((event) => event.requestId === "failed-id")).toMatchObject({ inputTokens: 22, outputTokens: 4, status: "failed" });
    expect(events.reduce((total, event) => total + event.inputTokens, 0)).toBe(133);
  });

  it("shortens repeated IDs, restores source IDs and rejects unknown model IDs", () => {
    const questionId = "provider-long-question-id-".repeat(8);
    const request = compactRequest({ taskType: "question_snapshot", system: "", prompt: JSON.stringify({ questions: [{ questionId, conversationId: "long-conversation", question: `Do not replace this text: ${questionId}` }] }), validate: (value) => value });
    const data = JSON.parse(request.prompt);
    expect(data.questions[0]).toMatchObject({ questionId: "q1", conversationId: "c1", question: `Do not replace this text: ${questionId}` });
    expect(request.validate({ snapshots: [{ questionId: "q1", conversationId: "c1" }] })).toEqual({ snapshots: [{ questionId, conversationId: "long-conversation" }] });
    expect(() => request.validate({ snapshots: [{ questionId: "q404" }] })).toThrow("Unknown source ID");
  });

  it("routes explicitly difficult extraction to the main model", async () => {
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      models.push(JSON.parse(String(init.body)).model);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    }));
    const ai = createAtlasAI({ ...settings, economyModel: "economy" });
    for (const qualityTier of ["economy", "main"]) await ai.extract({ taskType: "question_snapshot", system: "", prompt: JSON.stringify({ qualityTier, questions: [{ questionId: crypto.randomUUID(), question: "test" }] }), validate: (value) => value });
    expect(models).toEqual(["economy", "main"]);
  });
});

describe("lossless, ordered discussions", () => {
  it("keeps every character, middle correction and tail across token-bounded semantic segments", () => {
    const text = `${"开头推导。\n\n".repeat(800)}\n\n\`\`\`python\nx = 1\nprint(x)\n\`\`\`\n\n中间纠正：必须可观。${"继续解释😀。\n\n".repeat(500)}末尾条件不能忽略。`;
    const pieces = splitDiscussion(text, 1800);
    expect(pieces.join("")).toBe(text);
    expect(pieces.every((piece) => estimateTokens(piece) <= 1800)).toBe(true);
    expect(pieces.some((piece) => piece.includes("```python\nx = 1\nprint(x)\n```"))).toBe(true);
  });

  it("merges out-of-order long answer summaries in their original segment order", async () => {
    const id = crypto.randomUUID();
    const messages: ConversationMessage[] = ["解释推导", "连续推导。\n\n".repeat(1600)].map((content, index) => ({ id: `${id}-${index}`, conversationId: id, messageIndex: index, role: index ? "assistant" : "user", content, preview: content.slice(0, 20), contentHash: String(index), createdAt: 1, updatedAt: 1 }));
    const fake: AtlasAIProvider = { ...provider, generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      const data = JSON.parse(request.prompt);
      await delay(data.questions[0].segment?.index === 0 ? 20 : 1);
      return request.validate({ snapshots: data.questions.map((question: { questionId: string; conversationId: string; segment: { index: number } }) => ({ questionId: question.questionId, conversationId: question.conversationId, summary: `part-${question.segment.index}`, concepts: ["推导"] })) });
    } };
    const result = await ensureSemanticArtifacts({ conversations: [{ id, platform: "chatgpt", title: "推导", url: "", messageCount: 2, updatedAt: 1 }], loadMessages: async () => messages, provider: fake, requireAI: true, includeProfiles: false });
    const summary = result.snapshots[0].summary;
    expect(summary.indexOf("part-0")).toBeLessThan(summary.indexOf("part-1"));
    expect(summary.indexOf("part-1")).toBeLessThan(summary.indexOf("part-2"));
  });
});

describe("incremental outline safety and early reading", () => {
  const messages: ConversationMessage[] = Array.from({ length: 61 }, (_, index) => ({ id: `q${index}`, conversationId: "incremental", messageIndex: index, role: "user", content: `独立问题${index}`, preview: "", contentHash: `hash${index}`, createdAt: 1, updatedAt: 1 }));
  const snapshots = messages.map((message) => localSnapshot(message, undefined, 1));
  const hash = (items: ConversationMessage[]) => items.map((message) => `${message.id}:${message.contentHash}`).join("|");
  const graph: ConversationGraph = { conversationId: "incremental", sourceHash: hash(messages.slice(0, 60)), analysisModelKey: "test", organizationMode: "ai", nodes: [], edges: [], updatedAt: 1,
    chapters: Array.from({ length: 5 }, (_, order) => ({ id: `chapter${order}`, conversationId: "incremental", title: `主题${order}`, summary: `完整说明${order}`, order, questionIds: messages.slice(order * 12, (order + 1) * 12).map((message) => `conversation-message-${message.id}`), collapsed: true, source: "auto", createdAt: 1, updatedAt: 1 })) };

  it("reuses only an unedited unchanged prefix, falls back for corrections and model changes", () => {
    expect(incrementalChapterPrefix(graph, messages, snapshots, hash(messages), "test")?.questionCount).toBe(36);
    expect(incrementalChapterPrefix({ ...graph, userEdited: true }, messages, snapshots, hash(messages), "test")).toBeUndefined();
    expect(incrementalChapterPrefix(graph, messages, snapshots, hash(messages), "new-model")).toBeUndefined();
    expect(incrementalChapterPrefix(graph, messages, snapshots, "changed-source", "test")).toBeUndefined();
    expect(incrementalChapterPrefix(graph, [...messages.slice(0, -1), { ...messages.at(-1)!, content: "前面结论不对，需要纠正" }], snapshots, hash(messages), "test")).toBeUndefined();
  });

  it("plans only the active tail, emits validated contiguous previews and preserves all source IDs", async () => {
    const prefix = incrementalChapterPrefix(graph, messages, snapshots, hash(messages), "test")!;
    const readIds: string[] = []; const partials: string[][] = [];
    const fake: AtlasAIProvider = { ...provider, generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      const data = JSON.parse(request.prompt);
      if (!data.outlineOnly) readIds.push(...data.questions.map((question: { id: string }) => question.id));
      await delay(data.questions[0].id === "q36" ? 20 : 1);
      return request.validate({ chapters: [{ title: "连贯主题", summary: "保持全部讨论", questionIds: data.questions.map((question: { id: string }) => question.id) }], backbone: [0], episodes: [], bridgeCandidates: [], freeCardCandidates: [], profile: { summary: "全局概览" } });
    } };
    const result = await planLongConversation({ conversation: { id: "incremental", title: "递增讨论" }, snapshots: snapshots as QuestionSnapshot[], provider: fake, ...prefix, onPartial: (chapters) => partials.push(chapters.flatMap((chapter) => chapter.questionIds)) });
    expect(readIds).toEqual(messages.slice(36).map((message) => message.id));
    expect(result.chapters.flatMap((chapter) => chapter.questionIds)).toEqual(messages.map((message) => message.id));
    for (const ids of partials) expect(ids).toEqual(messages.slice(0, ids.length).map((message) => message.id));
  });

  it("measures elapsed and first-readable latency separately from queue and overlapping requests", () => {
    const rows = analyzeOrganizationRuns([{ id: "measured", title: "test", targetType: "conversation", targetIds: [], status: "waiting_review", stage: "proposal_ready", progress: 100, events: [], startedAt: 100, executionStartedAt: 200, firstReadableAt: 500, readyAt: 800, updatedAt: 10000 }], [], []);
    expect(rows[0]).toMatchObject({ elapsedMs: 600, firstReadableMs: 300, queueMs: 100, requestDurationMs: 0 });
    expect(organizationLatency(rows)).toEqual({ count: 1, p50: 600, p95: 600, firstReadableP50: 300 });
  });
});

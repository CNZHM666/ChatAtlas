import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIUsageEvent, Conversation, ConversationMessage } from "../shared/types";
import type { AtlasAIProvider, StructuredAIRequest } from "./provider";
import { getDatabase } from "../storage/db";
import { organizeConversationKnowledgeGraph } from "./conversation-knowledge-graph";
import { ensureSemanticArtifacts } from "./semantic-analysis";
import { mergeFocusPassages, chooseFocusPassages } from "./focus-materials";
import { transcriptPassages } from "../search/transcript-index";
import { requestBudget } from "./request-policy";
import { taskMessages } from "../shared/atlas/tasks.js";
import { estimateTokens, estimateMessageTokens, taskPolicy } from "../shared/atlas/policy.js";
import { sourceExcerpts } from "./source-evidence";
import { recordAIUsage, listAIUsage } from "../storage/ai-usage";
import { analyzeOrganizationRuns } from "./usage-analysis";
import { createAtlasAIFromProvider } from "./atlas-ai";
import { completeQuestionMaterials } from "./conversation-materials";
import { planLongConversation } from "./chapter-batches";

const conversation = (id: string): Conversation => ({ id, platform: "chatgpt", title: "极点与稳定性", url: "", messageCount: 4, updatedAt: 1 });
const message = (id: string, index: number, text: string): ConversationMessage => ({ id: `${id}-${index}`, conversationId: id, messageIndex: index, role: index % 2 ? "assistant" : "user", content: text, preview: text.slice(0, 40), contentHash: `${index}:${text.length}`, createdAt: 1, updatedAt: 1 });
afterEach(() => vi.restoreAllMocks());

describe("AI pipeline optimization", () => {
  it("uses one complete discussion request, reuses its overview in Knowledge Space, and only extracts an appended question", async () => {
    const item = conversation("optimized-one-pass");
    const messages = [message(item.id, 0, "极点如何影响稳定性？"), message(item.id, 1, "初步解释。MIDDLE_EVIDENCE。更正：要区分内部稳定性和输入输出稳定性。"), message(item.id, 2, "那么隐藏模态呢？"), message(item.id, 3, "不可控或不可观的模态可能被抵消。")];
    const tasks: string[] = [];
    const provider: AtlasAIProvider = { id: "test", modelId: "main", capabilities: { textGeneration: true, structuredOutput: "json", embeddings: false, conversationStructure: true }, testConnection: async () => ({ ok: true, model: "main" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      tasks.push(request.taskType!);
      const payload = JSON.parse(request.prompt);
      const questions = payload.questions as Array<{ questionId?: string; id?: string; conversationId?: string; answer?: string }>;
      const snapshots = questions.map((question) => ({ conversationId: item.id, questionId: question.questionId ?? question.id, displayTitle: "内部模态", summary: "区分内部模态与输入输出稳定性", concepts: ["稳定性", "内部模态"], answerKeypoint: "隐藏模态不能忽略" }));
      if (request.taskType === "question_snapshot") { expect(questions).toHaveLength(1); expect(questions[0].questionId).toBe(`${item.id}-4`); return request.validate({ snapshots }); }
      if (request.taskType === "conversation_structure") expect(questions[0].answer).toContain("MIDDLE_EVIDENCE");
      return request.validate({ snapshots, profile: { summary: "辨别不同稳定性的适用条件", concepts: ["稳定性", "内部模态"], domains: ["控制理论"] }, chapters: [{ title: "内部模态判断", summary: "从极点与隐藏模态辨别稳定性条件", questionIds: questions.map((question) => question.questionId ?? question.id) }], backbone: [0], episodes: [], bridgeCandidates: [], freeCardCandidates: [] });
    } };
    const graph = await organizeConversationKnowledgeGraph({ conversation: item, messages, provider, runId: "one-pass-run" });
    expect(tasks).toEqual(["conversation_structure"]);
    const db = await getDatabase(); await db.put("conversationGraphs", graph);
    await organizeConversationKnowledgeGraph({ conversation: item, messages, provider });
    await ensureSemanticArtifacts({ conversations: [item], provider, preferCachedArtifacts: true, requireAI: true, loadMessages: async () => { throw Error("cached overview should avoid loading raw messages"); } });
    expect(tasks).toEqual(["conversation_structure"]);
    await organizeConversationKnowledgeGraph({ conversation: { ...item, updatedAt: 2, messageCount: 6 }, messages: [...messages, message(item.id, 4, "如何验证这个条件？"), message(item.id, 5, "检查可控性与可观性。")], provider });
    expect(tasks).toEqual(["conversation_structure", "question_snapshot", "chapter_planning"]);
  });

  it("reads the middle of a long answer and saves a complete snapshot without an extra model merge", async () => {
    const item = conversation("optimized-long-answer");
    const answer = `${"开头推导。".repeat(1200)}MIDDLE_CORRECTION${"中间推导。".repeat(1200)}TAIL_CONDITION`;
    const pieces: string[] = [];
    const provider: AtlasAIProvider = { id: "test", modelId: "main", testConnection: async () => ({ ok: true, model: "main" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      const payload = JSON.parse(request.prompt); pieces.push(payload.questions[0].answer);
      return request.validate({ snapshots: payload.questions.map((question: { questionId: string; conversationId: string; answer: string }) => ({ ...question, summary: question.answer.includes("MIDDLE_CORRECTION") ? "中间更正" : question.answer.includes("TAIL_CONDITION") ? "末尾条件" : "推导", concepts: ["稳定性"] })) });
    } };
    const progress: number[][] = [];
    const result = await ensureSemanticArtifacts({ conversations: [item], loadMessages: async () => [message(item.id, 0, "解释稳定性"), message(item.id, 1, answer)], provider, requireAI: true, includeProfiles: false, mode: "fast", onQuestionProgress: (completed, total) => progress.push([completed, total]) });
    expect(pieces.join("")).toContain("MIDDLE_CORRECTION"); expect(pieces.join("")).toContain("TAIL_CONDITION");
    expect(result.snapshots[0].summary).toContain("中间更正"); expect(result.snapshots[0].summary).toContain("末尾条件");
    expect(progress.at(-1)).toEqual([1, 1]);
    const calls = pieces.length;
    await ensureSemanticArtifacts({ conversations: [item], loadMessages: async () => [message(item.id, 0, "解释稳定性"), message(item.id, 1, answer)], provider, requireAI: true, includeProfiles: false, mode: "fast" });
    expect(pieces).toHaveLength(calls);
  });

  it("plans a large conversation in bounded stages and preserves all question IDs through the final outline", async () => {
    const item = { ...conversation("optimized-large-outline"), messageCount: 100 };
    const messages = Array.from({ length: 100 }, (_, index) => ({ ...message(item.id, index, `控制系统问题 ${index}`), role: "user" as const }));
    const db = await getDatabase();
    for (const material of completeQuestionMaterials(messages, 1)) await db.put("questionSnapshots", { ...material.snapshot, summary: "系统极点与内部模态的约束条件。".repeat(22), analysisSource: "ai", analysisModelKey: "test:main", analysisMode: "balanced" });
    let requests = 0;
    const provider: AtlasAIProvider = { id: "test", modelId: "main", testConnection: async () => ({ ok: true, model: "main" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      requests++; expect(request.taskType).toBe("chapter_planning");
      const budget = requestBudget(request); expect(budget.inputTokens).toBeLessThanOrEqual(budget.maxInputTokens);
      const data = JSON.parse(request.prompt);
      return request.validate({ chapters: [{ title: "内部模态约束", summary: "结合极点与内部模态核对稳定性条件", questionIds: data.questions.map((question: { id: string }) => question.id) }], episodes: [], backbone: [0], profile: { summary: "完整的内部模态讨论", concepts: ["内部模态"], domains: ["控制理论"] }, bridgeCandidates: [], freeCardCandidates: [] });
    } };
    const graph = await organizeConversationKnowledgeGraph({ conversation: item, messages, provider });
    expect(requests).toBe(6);
    expect(graph.chapters?.flatMap((chapter) => chapter.questionIds)).toEqual(messages.map((message) => `conversation-message-${message.id}`));
    expect(graph.episodes?.flatMap((episode) => episode.questionIds)).toEqual(messages.map((message) => message.id));
  });

  it("merges overlapping source text once and includes a later correction for direct questions", () => {
    const item = conversation("optimized-focus");
    const passages = transcriptPassages(item, [message(item.id, 0, "极点判断稳定性？"), message(item.id, 1, "极点解释。".repeat(400)), message(item.id, 2, "还有补充吗？"), message(item.id, 3, "更正：不能忽略被抵消的内部模态。")]);
    const sameMessage = passages.filter((passage) => passage.evidence.messageId === `${item.id}-1`).slice(0, 2);
    const merged = mergeFocusPassages(sameMessage);
    expect(merged).toHaveLength(1); expect(merged[0].text.length).toBeLessThan(sameMessage.reduce((sum, passage) => sum + passage.text.length, 0));
    expect(chooseFocusPassages("极点如何判断稳定性？", passages, [item.id]).some((passage) => passage.text.includes("更正"))).toBe(true);
    expect(sourceExcerpts([message(item.id, 1, "开头。".repeat(400) + "稳定性条件更正：核对内部模态")], "稳定性 内部模态").some((excerpt) => excerpt.text.includes("更正"))).toBe(true);
  });

  it("fits eleven confirmed long sources without dropping their evidence", () => {
    const sources = Array.from({ length: 11 }, (_, index) => conversation(`long-source-${index}`));
    const passages = sources.flatMap((item) => transcriptPassages(item, [
      message(item.id, 0, "系统极点和稳定性如何关联？"),
      message(item.id, 1, `第 ${item.id} 条来源：` + "极点决定系统稳定性的讨论。".repeat(500)),
    ]));
    const picked = chooseFocusPassages("复习系统极点与稳定性", passages, sources.map((item) => item.id), "review", new Map(), "qwen-plus");
    expect(new Set(picked.map((item) => item.document.conversationId))).toEqual(new Set(sources.map((item) => item.id)));
    expect(estimateTokens(JSON.stringify(picked.map((item) => item.document.body)), "qwen-plus")).toBeLessThanOrEqual(taskPolicy("focus_session", { intent: "复习系统极点与稳定性", mode: "review" }).maxInputTokens - 2200);
    expect(picked.every((item) => item.document.body.includes("稳定性"))).toBe(true);
  });

  it("keeps all twenty-four sources for a direct question within the smaller answer budget", () => {
    const sources = Array.from({ length: 24 }, (_, index) => conversation(`answer-source-${index}`));
    const passages = sources.flatMap((item) => transcriptPassages(item, [message(item.id, 0, "极点如何影响稳定性？".repeat(200))]));
    const goal = "极点如何影响稳定性？";
    const picked = chooseFocusPassages(goal, passages, sources.map((item) => item.id), "review", new Map(), "qwen-plus");
    expect(new Set(picked.map((item) => item.document.conversationId)).size).toBe(24);
    expect(estimateTokens(JSON.stringify(picked.map((item) => item.document.body)), "qwen-plus")).toBeLessThanOrEqual(taskPolicy("focus_session", { intent: goal, mode: "review" }).maxInputTokens - 2200);
  });

  it("keeps intermediate outline merges bounded for a very large transcript", async () => {
    const item = conversation("hierarchical-outline");
    const snapshots = Array.from({ length: 1200 }, (_, index) => ({ conversationId: item.id, questionId: `q${index}`, displayTitle: `系统问题 ${index}`, summary: "稳定性条件与内部模态", concepts: ["稳定性"], sourceHash: `${index}`, analysisVersion: 1, updatedAt: 1 }));
    let outlineCalls = 0;
    const provider: AtlasAIProvider = { id: "test", modelId: "main", testConnection: async () => ({ ok: true, model: "main" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      const data = JSON.parse(request.prompt);
      if (data.outlineOnly) outlineCalls++;
      const budget = requestBudget(request); expect(budget.inputTokens).toBeLessThanOrEqual(budget.maxInputTokens);
      expect(data.questions.length).toBeLessThanOrEqual(200);
      const size = Math.ceil(data.questions.length / 8);
      const chapters = Array.from({ length: Math.ceil(data.questions.length / size) }, (_, index) => ({ title: "模态约束", summary: "根据原讨论核对稳定性与模态条件。".repeat(16), questionIds: data.questions.slice(index * size, (index + 1) * size).map((question: { id: string }) => question.id) }));
      return request.validate({ chapters, episodes: [], backbone: [], bridgeCandidates: [], freeCardCandidates: [] });
    } };
    const result = await planLongConversation({ conversation: item, snapshots, provider });
    expect(outlineCalls).toBeGreaterThan(2);
    expect(result.chapters.flatMap((chapter) => chapter.questionIds)).toEqual(snapshots.map((snapshot) => snapshot.questionId));
    expect(result.episodes.flatMap((episode) => episode.questionIds)).toEqual(snapshots.map((snapshot) => snapshot.questionId));
    expect(result.episodes.every((episode) => result.chapters[episode.chapterOrder].questionIds.includes(episode.questionIds[0]))).toBe(true);
  });

  it("uses the same budget as the server and reduces small-task output caps", () => {
    const data = { intent: "为什么极点能判断稳定性？", mode: "review", locale: "zh-CN", passages: [{ id: "e1", text: "稳定性条件".repeat(300) }] };
    const config = { llmModel: "qwen-plus", llmInputCnyPerMillion: .8, llmOutputCnyPerMillion: 2 };
    const budget = requestBudget({ taskType: "focus_session", system: "", prompt: JSON.stringify(data) }, config.llmModel);
    const upstream = taskMessages("focus_session", data);
    expect(budget.inputTokens).toBe(estimateMessageTokens(upstream, config.llmModel)); expect(budget.maxOutputTokens).toBe(taskPolicy("focus_session", data).maxOutputTokens); expect(budget.maxOutputTokens).toBe(1800);
  });

  it("does not repeat a network failure with unknown billing", async () => {
    const generateStructured = vi.fn().mockRejectedValue(new TypeError("network interrupted"));
    const atlas = createAtlasAIFromProvider({ id: "test", testConnection: async () => ({ ok: true, model: "main" }), generateStructured }, { id: "ai-settings", provider: "openai-compatible", baseUrl: "https://fixture.invalid", model: "main", apiKey: "fixture", updatedAt: 1 });
    await expect(atlas.synthesize({ system: "", prompt: "network-fixture-optimization", validate: (value) => value })).rejects.toThrow("network interrupted");
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });

  it("keeps one hosted receipt charge after reconnecting and includes standalone reading/index tasks in analysis", async () => {
    const fields: AIUsageEvent = { id: "receipt-first", runId: "focus-standalone", requestId: "fixture-receipt", createdAt: 5000, taskType: "focus_session", providerId: "atlas-demo", modelId: "qwen-plus", conversationIds: ["fixture"], inputTokens: 100, outputTokens: 50, costCny: .00018, tokenSource: "provider", status: "completed", attempt: 1 };
    await recordAIUsage(fields); await recordAIUsage({ ...fields, id: "receipt-reconnect", createdAt: 5001 });
    await recordAIUsage({ ...fields, id: "embedding-fixture", requestId: undefined, runId: "index-standalone", taskType: "embedding", inputTokens: 0, outputTokens: 0, embeddingTokens: 200, costCny: .0001 });
    const events = (await listAIUsage()).filter((event) => ["focus-standalone", "index-standalone"].includes(event.runId!));
    const rows = analyzeOrganizationRuns([], events, []);
    expect(rows.find((row) => row.run.id === "focus-standalone")).toMatchObject({ requests: 1, cacheHits: 1, costCny: .00018, synthetic: true });
    expect(rows.find((row) => row.run.id === "index-standalone")).toMatchObject({ requests: 1, embeddingTokens: 200, providerTokens: 200 });
  });
});

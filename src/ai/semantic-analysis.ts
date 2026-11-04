import { splitDiscussion } from "./discussion-segments";
import { requestBudget } from "./request-policy";
import { compactRequest } from "./compact-request";
import { executeBatches } from "./batch-executor";
import type { AtlasAIProvider, ProviderUsageSnapshot } from "./provider";
import type { AnalysisDiagnostics, Conversation, ConversationMessage, ConversationSemanticProfile, QuestionSnapshot } from "../shared/types";
import { getDatabase } from "../storage/db";
import { questionDisplayTitle } from "../canvas/conversation-structurer";
import { indexAnswersByQuestion } from "../canvas/conversation-graph";
import { ANALYSIS_VERSION, analyzedVersion, profileConversations } from "./conversation-profiler";
import { dependsOnEarlierContext } from "./episode-candidates";
import { estimateTokens } from "../shared/atlas/policy.js";
import { intentTerms } from "./knowledge-source-retrieval";

export type AnalysisMode = "fast" | "balanced" | "deep";
const modeRank: Record<AnalysisMode, number> = { fast: 0, balanced: 1, deep: 2 };

function reusable(artifact: { analysisSource?: "ai" | "fallback"; analysisModelKey?: string; analysisMode?: AnalysisMode }, provider: AtlasAIProvider | undefined, mode: AnalysisMode, artifactModelKey?: string): boolean {
  if (!provider) return true;
  // Existing installations have no provenance marker. Preserve those caches instead
  // of charging for a full library rebuild during the first run after an upgrade.
  if (artifact.analysisSource === undefined) return true;
  const modelKey = artifactModelKey ?? `${provider.id ?? "custom"}:${provider.modelId ?? "default"}`;
  return artifact.analysisSource === "ai" && artifact.analysisModelKey === modelKey && modeRank[artifact.analysisMode ?? "balanced"] >= modeRank[mode];
}

export interface SemanticArtifacts {
  profiles: ConversationSemanticProfile[];
  cachedProfiles: ConversationSemanticProfile[];
  snapshots: QuestionSnapshot[];
  freshConversationIds: string[];
  diagnostics: AnalysisDiagnostics;
}

export function localSnapshot(question: ConversationMessage, answer: ConversationMessage | undefined, now: number): QuestionSnapshot {
  const content = question.content.replace(/\s+/gu, " ").trim();
  const title = questionDisplayTitle(question.content);
  const terms = [
    ...(title.match(/[A-Za-z][A-Za-z0-9_.+#-]*[\p{Script=Han}]{1,6}|[A-Za-z][A-Za-z0-9_.+#-]{1,}/gu) ?? []),
    ...title.split(/[，,。；;：:\s的和与及]/u).map((part) => part.replace(/^(?:那|这个|那个|什么是|为什么|怎么|如何|是否|能否|可以|介绍|解释)/u, "").replace(/[吗呢吧了]$/u, "").trim()),
  ];
  const concepts = [...new Set(terms.filter((term) => [...term].length >= 2 && [...term].length <= 12 && !/^(?:请问|帮我|一下|什么|怎么|如何|可以|问题|方法|内容|学习|讨论|整理|please|help|what|how)$/iu.test(term) && !/[？?]/u.test(term)))].slice(0, 6);
  return {
    questionId: question.id, conversationId: question.conversationId, messageIndex: question.messageIndex,
    displayTitle: title, summary: content.slice(0, 180), concepts,
    intent: /为什么|原理|why|explain/iu.test(content) ? "理解原理" : /实现|代码|build|implement/iu.test(content) ? "解决与实现" : "学习与探索",
    answerKeypoint: answer?.content.replace(/\s+/gu, " ").slice(0, 220),
    analysisSource: "fallback",
    sourceHash: `${question.contentHash}:${answer?.contentHash ?? ""}:full-v2`, analysisVersion: ANALYSIS_VERSION, updatedAt: now,
  };
}

export function validateSnapshots(value: unknown, fallback: QuestionSnapshot[]): QuestionSnapshot[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { snapshots?: unknown }).snapshots)) throw new Error("Invalid question snapshot response");
  const raw = (value as { snapshots: Array<Record<string, unknown>> }).snapshots;
  const questionIdCounts = new Map<string, number>();
  for (const item of fallback) questionIdCounts.set(item.questionId, (questionIdCounts.get(item.questionId) ?? 0) + 1);
  return fallback.map((item) => {
    const candidate = raw.find((entry) => entry && typeof entry === "object" && entry.questionId === item.questionId && (entry.conversationId === item.conversationId || entry.conversationId === undefined && questionIdCounts.get(item.questionId) === 1));
    if (!candidate) return item;
    return {
      ...item,
      analysisSource: typeof candidate.summary === "string" && candidate.summary.trim() ? "ai" : "fallback",
      displayTitle: typeof candidate.displayTitle === "string" && candidate.displayTitle.trim() ? candidate.displayTitle.trim().slice(0, 80) : item.displayTitle,
      summary: typeof candidate.summary === "string" && candidate.summary.trim() ? candidate.summary.trim().slice(0, 300) : item.summary,
      concepts: Array.isArray(candidate.concepts) && candidate.concepts.some((concept) => typeof concept === "string" && concept.trim()) ? candidate.concepts.filter((concept): concept is string => typeof concept === "string" && Boolean(concept.trim())).map((concept) => concept.trim()).slice(0, 8) : item.concepts,
      intent: typeof candidate.intent === "string" && candidate.intent.trim() ? candidate.intent.trim().slice(0, 80) : item.intent,
      answerKeypoint: typeof candidate.answerKeypoint === "string" && candidate.answerKeypoint.trim() ? candidate.answerKeypoint.trim().slice(0, 260) : item.answerKeypoint,
    };
  });
}

function countRequest(diagnostics: AnalysisDiagnostics, inputCharacters: number, outputCharacters: number): void {
  diagnostics.aiRequests += 1;
  diagnostics.estimatedInputTokens += Math.ceil(inputCharacters / 4);
  diagnostics.estimatedOutputTokens += Math.ceil(outputCharacters / 4);
}

export function recordProviderUsage(diagnostics: AnalysisDiagnostics, before?: ProviderUsageSnapshot, after?: ProviderUsageSnapshot): void {
  if (!before || !after) return;
  diagnostics.providerRequests = after.requests - before.requests;
  diagnostics.providerUsageReportedRequests = after.reportedRequests - before.reportedRequests;
  diagnostics.cacheHits = diagnostics.cachedQuestionsReused + (after.cacheHits ?? 0) - (before.cacheHits ?? 0);
  diagnostics.cacheMisses = (after.cacheMisses ?? 0) - (before.cacheMisses ?? 0);
  diagnostics.retries = (after.retries ?? 0) - (before.retries ?? 0);
  if (diagnostics.providerUsageReportedRequests > 0) {
    diagnostics.actualInputTokens = after.inputTokens - before.inputTokens;
    diagnostics.actualOutputTokens = after.outputTokens - before.outputTokens;
  }
}

function compactSemanticText(value: string | undefined, limit: number): string {
  const text = value?.replace(/\s+/gu, " ").trim() ?? "";
  if (text.length <= limit) return text;
  const head = Math.floor(limit * .75);
  return `${text.slice(0, head)}…${text.slice(-(limit - head - 1))}`;
}

export async function ensureSemanticArtifacts(input: {
  conversations: Conversation[];
  runId?: string;
  loadMessages: (conversationId: string) => Promise<ConversationMessage[]>;
  provider?: AtlasAIProvider;
  mode?: AnalysisMode;
  includeProfiles?: boolean;
  preferCachedArtifacts?: boolean;
  intent?: string;
  requireAI?: boolean;
  now?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number, cached: number) => void;
  onProfileProgress?: (completed: number, total: number) => void;
  onQuestionProgress?: (completed: number, total: number) => void;
}): Promise<SemanticArtifacts> {
  const now = input.now ?? Date.now();
  const mode = input.mode ?? "balanced";
  const modelKey = input.provider ? await input.provider.getAnalysisKey?.() ?? `${input.provider.id ?? "custom"}:${input.provider.modelId ?? "default"}` : undefined;
  const usageBefore = input.provider?.getUsageSnapshot?.();
  const db = await getDatabase();
  const diagnostics: AnalysisDiagnostics = { id: `analysis-${now}-${crypto.randomUUID()}`, createdAt: now, runId: input.runId, questionsAnalyzed: 0, cachedQuestionsReused: 0, rawMessagesLoaded: 0, aiRequests: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0, relationsVerified: 0, bridgesGenerated: 0, questionCount: 0, topicCount: 0, relationCount: 0, bridgeCount: 0 };
  const cachedProfiles = new Map((input.includeProfiles === false ? [] : await db.getAll("semanticProfiles")).map((profile) => [profile.conversationId, profile]));
  const freshInputs: Array<{ conversation: Conversation; snapshots: QuestionSnapshot[] }> = [];
  const allSnapshots: QuestionSnapshot[] = [];
  const freshConversationIds: string[] = [];
  const pending = new Map<string, { conversation: Conversation; questionOrder: Map<string, number>; snapshots: QuestionSnapshot[]; remaining: number }>();
  const freshQuestions: Array<{ conversationId: string; question: string; answer: string; context: string; fallback: QuestionSnapshot; segment?: { index: number; total: number } }> = [];
  const segmentResults = new Map<string, Map<number, QuestionSnapshot>>();
  const localSnapshotsToSave: QuestionSnapshot[] = [];
  const segmentTokenLimit = mode === "deep" ? 6000 : 5000;
  let completed = 0;
  let cachedCompleted = 0;
  for (const conversation of input.conversations) {
    input.signal?.throwIfAborted();
    const cachedProfile = cachedProfiles.get(conversation.id);
    if (input.includeProfiles !== false && cachedProfile?.analysisVersion === ANALYSIS_VERSION && cachedProfile.analyzedVersion === analyzedVersion(conversation) && (reusable(cachedProfile, input.provider, mode, modelKey) || input.preferCachedArtifacts && (cachedProfile.analysisSource !== "fallback" || !input.requireAI))) {
      diagnostics.cachedQuestionsReused += cachedProfile.questionCount ?? 0;
      input.onProgress?.(++completed, input.conversations.length, ++cachedCompleted);
      continue;
    }
    if (input.preferCachedArtifacts && input.includeProfiles !== false) {
      const cachedSnapshots = await db.getAllFromIndex("questionSnapshots", "by-conversation", conversation.id);
      if (cachedSnapshots.length && cachedSnapshots.every((snapshot) => snapshot.analysisVersion === ANALYSIS_VERSION && snapshot.updatedAt >= conversation.updatedAt && (snapshot.analysisSource !== "fallback" || !input.requireAI))) {
        const orderById = cachedSnapshots.every((snapshot) => snapshot.messageIndex !== undefined) ? null : new Map((await input.loadMessages(conversation.id)).filter((message) => message.role === "user").map((message) => [message.id, message.messageIndex]));
        if (orderById) diagnostics.rawMessagesLoaded += orderById.size;
        const ordered = cachedSnapshots.sort((a, b) => (a.messageIndex ?? orderById?.get(a.questionId) ?? 0) - (b.messageIndex ?? orderById?.get(b.questionId) ?? 0));
        freshInputs.push({ conversation, snapshots: ordered });
        allSnapshots.push(...ordered);
        freshConversationIds.push(conversation.id);
        diagnostics.cachedQuestionsReused += ordered.length;
        input.onProgress?.(++completed, input.conversations.length, ++cachedCompleted);
        continue;
      }
    }
    const messages = await input.loadMessages(conversation.id);
    diagnostics.rawMessagesLoaded += messages.length;
    const previous = new Map((await db.getAllFromIndex("questionSnapshots", "by-conversation", conversation.id)).map((snapshot) => [snapshot.questionId, snapshot]));
    const orderedMessages = [...messages].sort((a, b) => a.messageIndex - b.messageIndex);
    const messagePositions = new Map(orderedMessages.map((message, index) => [message.id, index]));
    const questions = orderedMessages.filter((message) => message.role === "user");
    const answers = indexAnswersByQuestion(orderedMessages);
    const snapshots: QuestionSnapshot[] = [];
    // Knowledge Space needs a representative semantic profile, not a second full
    // chapter analysis. Keep every question locally, but AI-read only a spread sample.
    const sampleLimit = mode === "fast" ? 8 : mode === "deep" ? 24 : 12;
    let sampledIndices: Set<number> | null = null;
    if (input.preferCachedArtifacts && input.provider && questions.length > sampleLimit) {
      const terms = intentTerms(input.intent ?? "");
      const ranked = questions.map((question, index) => ({ index, score: terms.reduce((sum, term) => sum + Number(`${question.content} ${(answers.get(question.id) ?? []).map((answer) => answer.content).join(" ")}`.toLocaleLowerCase().includes(term)) * term.length, 0) })).sort((a, b) => b.score - a.score || b.index - a.index);
      sampledIndices = new Set([0, questions.length - 1]);
      for (const item of ranked) { if (sampledIndices.size >= sampleLimit) break; if (item.score > 0) { if (dependsOnEarlierContext(questions[item.index].content) && item.index > 0) sampledIndices.add(item.index - 1); if (sampledIndices.size < sampleLimit) sampledIndices.add(item.index); } }
      for (let i = 0; sampledIndices.size < sampleLimit && i < sampleLimit; i++) sampledIndices.add(Math.round(i * (questions.length - 1) / (sampleLimit - 1)));
      for (const item of ranked) { if (sampledIndices.size >= sampleLimit) break; sampledIndices.add(item.index); }
    }
    for (const [questionIndex, question] of questions.entries()) {
      const answerParts = answers.get(question.id) ?? [];
      const answer = answerParts[0] ? { ...answerParts[0], content: answerParts.map((part) => part.content).join("\n"), contentHash: answerParts.map((part) => part.contentHash).join(":") } : undefined;
      const fallback = localSnapshot(question, answer, now);
      const messagePosition = messagePositions.get(question.id) ?? 0;
      if (dependsOnEarlierContext(question.content)) fallback.sourceHash += `:${orderedMessages.slice(Math.max(0, messagePosition - 2), messagePosition).map((message) => message.contentHash).join(":")}`;
      const cached = previous.get(question.id);
      if (cached?.analysisVersion === ANALYSIS_VERSION && cached.sourceHash === fallback.sourceHash && reusable(cached, input.provider, mode, modelKey)) {
        snapshots.push(cached); diagnostics.cachedQuestionsReused += 1;
      } else if (sampledIndices && !sampledIndices.has(questionIndex)) {
        snapshots.push(fallback);
        localSnapshotsToSave.push(fallback);
      } else {
        const context = orderedMessages.slice(Math.max(0, messagePosition - 2), messagePosition).map((message) => `${message.role}: ${compactSemanticText(message.content, 500)}`).join("\n");
        const full = `user: ${question.content}\nassistant: ${answer?.content ?? ""}`;
        if (estimateTokens(full) <= segmentTokenLimit) freshQuestions.push({ conversationId: conversation.id, question: question.content, answer: answer?.content ?? "", context, fallback });
        else {
          const segments = splitDiscussion(full, segmentTokenLimit);
          for (const [part, answer] of segments.entries()) freshQuestions.push({ conversationId: conversation.id, question: question.content.slice(0, 500), answer, context: `${context}${part ? `\nPrevious segment (context only): ${segments[part - 1].slice(-350)}` : ""}`, fallback, segment: { index: part, total: segments.length } });
        }
      }
    }
    const remaining = questions.length - snapshots.length;
    pending.set(conversation.id, { conversation, questionOrder: new Map(questions.map((question, index) => [question.id, index])), snapshots, remaining });
    if (remaining === 0) input.onProgress?.(++completed, input.conversations.length, cachedCompleted);
  }
  if (localSnapshotsToSave.length) {
    const tx = db.transaction("questionSnapshots", "readwrite");
    for (const snapshot of localSnapshotsToSave) await tx.store.put(snapshot);
    await tx.done;
  }
  const freshQuestionCount = new Set(freshQuestions.map((item) => `${item.conversationId}:${item.fallback.questionId}`)).size;
  if (input.onQuestionProgress) input.onQuestionProgress(diagnostics.cachedQuestionsReused, diagnostics.cachedQuestionsReused + freshQuestionCount);
  const batches: Array<typeof freshQuestions> = [];
  for (let index = 0; index < freshQuestions.length;) {
    input.signal?.throwIfAborted();
    const batch: typeof freshQuestions = [];
    while (index < freshQuestions.length && batch.length < 12) {
      const next = freshQuestions[index];
      const candidate = [...batch, next];
      const prompt = JSON.stringify({ questions: candidate.map((item) => ({ conversationId: item.conversationId, questionId: item.fallback.questionId, precedingContext: item.context, question: item.question, answer: item.answer, segment: item.segment })) });
      const budget = requestBudget(compactRequest({ taskType: "question_snapshot", system: "", prompt, validate: (value) => value }));
      // Reserve output space for every row as well as the complete wire input.
      if (batch.length && (budget.inputTokens > 11000 || candidate.reduce((total, item) => total + 180 + Math.min(320, Math.ceil(estimateTokens(`${item.question} ${item.answer}`) / 5)), 0) > budget.maxOutputTokens)) break;
      if (batch.some((item) => item.conversationId === next.conversationId && item.fallback.questionId === next.fallback.questionId)) break;
      batch.push(next);
      index += 1;
    }
    batches.push(batch);
  }
  await executeBatches(batches, input.provider, async (batch) => {
    let built = batch.map((item) => item.fallback);
    if (input.provider) {
      const prompt = JSON.stringify({ qualityTier: mode === "deep" || batch.some((item) => item.segment || /纠正|更正|修正|不对|推翻|不是.{0,24}而是|correction|incorrect|actually|contradict/iu.test(`${item.question} ${item.answer}`)) ? "main" : "economy", questions: batch.map((item) => ({ conversationId: item.conversationId, questionId: item.fallback.questionId, precedingContext: item.context, question: item.question, answer: item.answer, segment: item.segment })), schema: { snapshots: [{ conversationId: "source conversation id", questionId: "id", displayTitle: "short title", summary: "meaning", concepts: ["durable concept"], intent: "intent", answerKeypoint: "optional" }] } });
      try {
        const request = { taskType: "question_snapshot" as const, conversationIds: [...new Set(batch.map((item) => item.conversationId))], system: "Create durable, traceable question snapshots. Use precedingContext only to resolve references and follow-up meaning; preserve the current question and answer as evidence. Return strict JSON. Keep each conversationId and questionId unchanged. Do not invent facts absent from the supplied text.", prompt, validate: (value: unknown) => validateSnapshots(value, built), cacheIf: (result: QuestionSnapshot[]) => result.every((snapshot) => snapshot.analysisSource === "ai") };
        built = await (input.provider.extract?.(request) ?? input.provider.generateStructured(request));
        if (input.requireAI && built.some((snapshot) => snapshot.analysisSource !== "ai")) throw new Error("AI returned incomplete question analysis. Retry this task.");
        countRequest(diagnostics, prompt.length, JSON.stringify(built).length);
        diagnostics.extractCalls = (diagnostics.extractCalls ?? 0) + 1;
      } catch (error) { input.signal?.throwIfAborted(); countRequest(diagnostics, prompt.length, 0); diagnostics.extractCalls = (diagnostics.extractCalls ?? 0) + 1; diagnostics.schemaFailures = (diagnostics.schemaFailures ?? 0) + 1; if (input.requireAI) throw error; }
      }
    input.signal?.throwIfAborted();
    built = built.flatMap((snapshot, itemIndex) => {
      const segment = batch[itemIndex].segment;
      if (!segment) return [snapshot];
      const key = `${snapshot.conversationId}:${snapshot.questionId}`;
      const received = segmentResults.get(key) ?? new Map<number, QuestionSnapshot>();
      received.set(segment.index, snapshot); segmentResults.set(key, received);
      if (received.size < segment.total) return [];
      const parts = [...received].sort(([a], [b]) => a - b).map(([, part]) => part);
      segmentResults.delete(key);
      return [{ ...parts[0], summary: parts.map((part, index) => `${index + 1}. ${part.summary}`).join("\n"), answerKeypoint: parts.map((part, index) => `${index + 1}. ${part.answerKeypoint ?? part.summary}`).join("\n"), concepts: [...new Set(parts.flatMap((part) => part.concepts))].slice(0, 12), analysisSource: parts.every((part) => part.analysisSource === "ai") ? "ai" as const : "fallback" as const }];
    }).map((snapshot) => ({ ...snapshot, analysisModelKey: snapshot.analysisSource === "ai" ? modelKey : undefined, analysisMode: mode }));
    const tx = db.transaction("questionSnapshots", "readwrite");
    for (const snapshot of built) await tx.store.put(snapshot);
    await tx.done;
    for (const snapshot of built) {
      const state = pending.get(snapshot.conversationId)!;
      state.snapshots.push(snapshot);
      state.remaining -= 1;
      if (state.remaining === 0) input.onProgress?.(++completed, input.conversations.length, cachedCompleted);
    }
    diagnostics.questionsAnalyzed += built.length;
    input.onQuestionProgress?.(diagnostics.cachedQuestionsReused + diagnostics.questionsAnalyzed, diagnostics.cachedQuestionsReused + freshQuestionCount);
  }, input.signal);
  for (const { conversation, questionOrder, snapshots } of pending.values()) {
    snapshots.sort((a, b) => (questionOrder.get(a.questionId) ?? 0) - (questionOrder.get(b.questionId) ?? 0));
    if (input.includeProfiles !== false) freshInputs.push({ conversation, snapshots });
    allSnapshots.push(...snapshots);
    freshConversationIds.push(conversation.id);
  }
  input.signal?.throwIfAborted();
  if (freshInputs.length) input.onProfileProgress?.(0, freshInputs.length);
  const freshProfiles = (await profileConversations(freshInputs, input.provider, (inputChars, outputChars, failed) => { countRequest(diagnostics, inputChars, outputChars); diagnostics.extractCalls = (diagnostics.extractCalls ?? 0) + 1; if (failed) diagnostics.schemaFailures = (diagnostics.schemaFailures ?? 0) + 1; }, input.mode, input.onProfileProgress, input.requireAI)).map((profile) => ({
    ...profile,
    analysisSource: profile.analysisSource === "ai" && (input.preferCachedArtifacts || freshInputs.find((item) => item.conversation.id === profile.conversationId)?.snapshots.every((snapshot) => snapshot.analysisSource === "ai")) ? "ai" as const : "fallback" as const,
    analysisModelKey: profile.analysisSource === "ai" ? modelKey : undefined,
    analysisMode: mode,
    coverage: freshInputs.find((item) => item.conversation.id === profile.conversationId)?.snapshots.every((snapshot) => snapshot.analysisSource === "ai") ? "complete" as const : "sampled" as const,
  }));
  input.signal?.throwIfAborted();
  const profileTx = db.transaction("semanticProfiles", "readwrite");
  for (const profile of freshProfiles) await profileTx.store.put(profile);
  await profileTx.done;
  const freshById = new Map(freshProfiles.map((profile) => [profile.conversationId, profile]));
  const profiles = input.includeProfiles === false ? [] : input.conversations.map((conversation) => freshById.get(conversation.id) ?? cachedProfiles.get(conversation.id)).filter((profile): profile is ConversationSemanticProfile => Boolean(profile));
  diagnostics.questionCount = input.includeProfiles === false ? allSnapshots.length : profiles.reduce((sum, profile) => sum + (profile.questionCount ?? 0), 0);
  recordProviderUsage(diagnostics, usageBefore, input.provider?.getUsageSnapshot?.());
  return { profiles, cachedProfiles: [...cachedProfiles.values()], snapshots: allSnapshots, freshConversationIds, diagnostics };
}

export async function saveAnalysisDiagnostics(value: AnalysisDiagnostics): Promise<void> {
  await (await getDatabase()).put("analysisDiagnostics", value);
}

export async function listAnalysisDiagnostics(): Promise<AnalysisDiagnostics[]> {
  return (await (await getDatabase()).getAll("analysisDiagnostics")).sort((a, b) => b.createdAt - a.createdAt);
}

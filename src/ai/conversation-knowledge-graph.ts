import { incrementalChapterPrefix } from "./incremental-chapters";
import { planLongConversation } from "./chapter-batches";
import type { AtlasAIProvider } from "./provider";
import type { Conversation, ConversationChapter, ConversationGraph, ConversationMessage, QuestionSnapshot } from "../shared/types";
import { getDatabase } from "../storage/db";
import type { ConversationStructure } from "../canvas/conversation-structurer";
import { generateConversationGraph } from "../canvas/conversation-graph";
import { ANALYSIS_VERSION, analyzedVersion } from "./conversation-profiler";
import { ensureSemanticArtifacts, recordProviderUsage, saveAnalysisDiagnostics, validateSnapshots, type AnalysisMode } from "./semantic-analysis";
import { evaluateStructureQuality } from "./structure-quality";
import { COMPOSITION_BUDGET, selectCompositionCandidates, usefulCompositionText } from "./composition-guard";
import { buildContextEpisodes, type EpisodePlan } from "./context-episodes";
import { suggestEpisodeBoundaries } from "./episode-candidates";
import { completeQuestionMaterials, overviewFromPlan, saveConversationMaterials } from "./conversation-materials";
import { requestBudget } from "./request-policy";
import { atlasApiClient } from "./demo-api";
import { recordAIUsage } from "../storage/ai-usage";

export function validateConversationChapterPlan(value: unknown, conversation: Conversation, ordered: QuestionSnapshot[], fallback: ConversationStructure, now: number): ConversationStructure {
  if (!value || typeof value !== "object") throw new Error("Invalid chapter plan");
  const result = value as { groups?: Array<Record<string, unknown>>; chapters?: Array<Record<string, unknown>>; episodes?: Array<Record<string, unknown>>; backbone?: unknown; bridgeCandidates?: Array<Record<string, unknown>>; freeCardCandidates?: Array<Record<string, unknown>> };
  const groups = result.chapters ?? result.groups;
  if (!Array.isArray(groups)) throw new Error("Invalid chapter plan");
  const maxGroups = ordered.length <= 3 ? Math.min(2, ordered.length) : ordered.length > 25 ? 9 : ordered.length > 12 ? 6 : 4;
  if (!groups.length || groups.length > maxGroups || ordered.length >= 10 && groups.length / ordered.length > .45) throw new Error("Insufficient compression");
  if (groups.some((group) => !group || !Array.isArray(group.questionIds) || !group.questionIds.length)) throw new Error("Invalid chapter questions");
  const questionIds = groups.flatMap((group) => group.questionIds);
  const orderById = new Map(ordered.map((snapshot, index) => [snapshot.questionId, index]));
  if (questionIds.length !== ordered.length || new Set(questionIds).size !== ordered.length || questionIds.some((id) => typeof id !== "string" || !orderById.has(id))) throw new Error("Question coverage changed");
  if (groups.some((group) => (group.questionIds as string[]).some((id, index) => index > 0 && (orderById.get(id) ?? -1) < (orderById.get((group.questionIds as string[])[index - 1]) ?? -1)))) throw new Error("Question order changed within a chapter");
  if (questionIds.some((id, index) => id !== ordered[index]?.questionId)) throw new Error("Chapter boundaries split the original conversation");
  if (groups.some((group, index) => index > 0 && (orderById.get((group.questionIds as string[])[0]) ?? -1) < (orderById.get((groups[index - 1].questionIds as string[])[0]) ?? -1))) throw new Error("Chapter order changed");
  const draftChapters: ConversationChapter[] = groups.map((group, order) => {
    if (typeof group.title !== "string" || !group.title.trim() || typeof group.summary !== "string" || !group.summary.trim() || !Array.isArray(group.questionIds) || !group.questionIds.length) throw new Error("Invalid chapter");
    return { id: `conversation-chapter-${conversation.id}-${order + 1}`, conversationId: conversation.id, title: group.title.trim().slice(0, 52), summary: group.summary.trim().slice(0, 220), questionIds: (group.questionIds as string[]).map((id) => `conversation-message-${id}`), order, collapsed: true, source: "auto", createdAt: now, updatedAt: now };
  });
  // The model has already assigned every question. Reclassifying with local keyword rules
  // can merge unrelated stages and replace specific summaries with fixed templates.
  const chapters: ConversationChapter[] = draftChapters;
  const quality = evaluateStructureQuality({ questionCount: ordered.length, chapterTitles: chapters.map((chapter) => chapter.title), relationCount: fallback.questionRelations.filter((relation) => relation.type !== "continue").length + Math.max(0, chapters.length - 1), bridgeCount: 0, coveredQuestionCount: chapters.flatMap((chapter) => chapter.questionIds).length });
  if (!quality.accepted) throw new Error(`Structure quality rejected: ${[...quality.genericTitles, ...quality.questionLikeTitles, ...quality.duplicateChapters.flat()].join(",") || "poor compression"}`);
  if (result.backbone !== undefined && (!Array.isArray(result.backbone) || result.backbone.length !== groups.length || result.backbone.some((item, index) => item !== index))) throw new Error("Invalid backbone order");
  const validQuestionIds = new Set(ordered.map((snapshot) => snapshot.questionId));
  const context = chapters.flatMap((chapter) => [chapter.title, chapter.summary ?? ""]);
  const bridges = selectCompositionCandidates(chapters.length === groups.length ? result.bridgeCandidates ?? [] : [], COMPOSITION_BUDGET.conversation.bridges,
    (candidate) => `${candidate.fromOrder}:${candidate.toOrder}`,
    (candidate) => Number.isInteger(candidate.fromOrder) && Number.isInteger(candidate.toOrder) && Number(candidate.toOrder) === Number(candidate.fromOrder) + 1 && Number(candidate.fromOrder) >= 0 && Number(candidate.toOrder) < chapters.length && usefulCompositionText(candidate.text, context) && Array.isArray(candidate.questionIds) && candidate.questionIds.some((id) => (groups[Number(candidate.fromOrder)].questionIds as string[]).includes(String(id))) && candidate.questionIds.some((id) => (groups[Number(candidate.toOrder)].questionIds as string[]).includes(String(id)))
  ).map((candidate) => ({ fromOrder: Number(candidate.fromOrder), toOrder: Number(candidate.toOrder), explanation: String(candidate.text).trim().slice(0, 160), questionIds: (candidate.questionIds as string[]).filter((id) => validQuestionIds.has(id)).map((id) => `conversation-message-${id}`) }));
  const freeCards = selectCompositionCandidates(chapters.length === groups.length ? result.freeCardCandidates ?? [] : [], COMPOSITION_BUDGET.conversation.freeCards,
    (candidate) => `${candidate.type}:${String(candidate.title ?? "")}`,
    (candidate) => (candidate.type === "insight" || candidate.type === "draft") && Number.isInteger(candidate.afterOrder) && Number(candidate.afterOrder) >= 0 && Number(candidate.afterOrder) < chapters.length && typeof candidate.title === "string" && candidate.title.trim().length >= 4 && !context.some((item) => item && item.includes(String(candidate.title).trim())) && Array.isArray(candidate.questionIds) && new Set(candidate.questionIds.filter((id) => validQuestionIds.has(String(id)))).size >= (candidate.type === "insight" ? 2 : 1) && (candidate.type === "draft" || usefulCompositionText(candidate.body, context))
  ).map((candidate) => ({ afterOrder: Number(candidate.afterOrder), type: candidate.type as "insight" | "draft", title: String(candidate.title).trim().slice(0, 50), body: candidate.type === "insight" ? String(candidate.body).trim().slice(0, 220) : undefined, questionIds: (candidate.questionIds as string[]).filter((id) => validQuestionIds.has(id)).map((id) => `conversation-message-${id}`) }));
  const episodePlans: EpisodePlan[] = (result.episodes ?? []).flatMap((item) => Number.isInteger(item.chapterOrder) && typeof item.title === "string" && Array.isArray(item.questionIds) && item.questionIds.every((id) => typeof id === "string") ? [{ chapterOrder: Number(item.chapterOrder), title: item.title, questionIds: item.questionIds as string[], contextHeader: typeof item.contextHeader === "string" ? item.contextHeader : undefined, summary: typeof item.summary === "string" ? item.summary : undefined, concepts: Array.isArray(item.concepts) ? item.concepts.filter((concept): concept is string => typeof concept === "string") : undefined }] : []);
  return { chapters, questionRelations: fallback.questionRelations, bridges, freeCards, episodePlans };
}

/** Review only the optional decorations; a failed review never discards the chapter backbone. */
export async function judgeConversationComposition(structure: ConversationStructure, ordered: QuestionSnapshot[], provider: AtlasAIProvider, onRequest?: (inputLength: number, outputLength: number, failed: boolean) => void): Promise<ConversationStructure> {
  const candidates = [
    ...(structure.bridges ?? []).map((card, index) => ({ id: `bridge:${index}`, type: "bridge", text: card.explanation, questionIds: card.questionIds })),
    ...(structure.freeCards ?? []).map((card, index) => ({ id: `free:${index}`, type: card.type, text: `${card.title} ${card.body ?? ""}`, questionIds: card.questionIds })),
  ];
  if (!candidates.length) return structure;
  const snapshots = new Map(ordered.map((item) => [item.questionId, item]));
  const prompt = JSON.stringify({ candidates: candidates.map((candidate) => ({ id: candidate.id, type: candidate.type, claim: candidate.text, evidence: candidate.questionIds.slice(0, 3).map((id) => { const snapshot = snapshots.get(id.replace(/^conversation-message-/u, "")); return snapshot ? { questionId: snapshot.questionId, summary: snapshot.summary.slice(0, 180) } : null; }).filter(Boolean) })), task: "Keep a card only if it adds a non-redundant, specific connection or insight grounded in supplied question summaries. A draft must identify a genuine missing user decision, not invent an answer. Return one judgment per candidate; reject speculation.", schema: { decisions: [{ id: "candidate id", supported: true, useful: true }] } });
  try {
    const request = { taskType: "composition_judge" as const, conversationIds: [...new Set(ordered.map((item) => item.conversationId))], system: "Conservative knowledge-composition judge. Verify optional cards against their sources. Return strict JSON.", prompt, validate: (value: unknown) => {
      if (!value || typeof value !== "object" || !Array.isArray((value as { decisions?: unknown }).decisions)) throw new Error("Invalid composition judgments");
      return (value as { decisions: Array<Record<string, unknown>> }).decisions;
    } };
    const decisions = await (provider.decide?.(request) ?? provider.generateStructured(request));
    onRequest?.(prompt.length, JSON.stringify(decisions).length, false);
    const accepted = new Set(decisions.filter((item) => item.supported === true && item.useful === true && typeof item.id === "string" && candidates.some((candidate) => candidate.id === item.id)).map((item) => item.id));
    return { ...structure, bridges: structure.bridges?.filter((_, index) => accepted.has(`bridge:${index}`)), freeCards: structure.freeCards?.filter((_, index) => accepted.has(`free:${index}`)) };
  } catch {
    onRequest?.(prompt.length, 0, true);
    return { ...structure, bridges: [], freeCards: [] };
  }
}

/** One explicit AI pass over cached snapshots; raw messages are loaded only for stale snapshots. */
export async function organizeConversationKnowledgeGraph(input: {
  conversation: Conversation;
  runId?: string;
  messages: ConversationMessage[];
  provider: AtlasAIProvider;
  mode?: AnalysisMode;
  enrich?: boolean;
  force?: boolean;
  onPartial?: (chapters: ConversationChapter[]) => void;
  now?: number;
  signal?: AbortSignal;
  onProgress?: (stage: "questions" | "planning" | "validation", completed: number, total: number) => void;
}): Promise<ConversationGraph> {
  const now = input.now ?? Date.now();
  const modelKey = await input.provider.getAnalysisKey?.() ?? `${input.provider.id ?? "custom"}:${input.provider.modelId ?? "default"}`;
  const usageBefore = input.provider.getUsageSnapshot?.();
  const db = await getDatabase();
  const complete = completeQuestionMaterials(input.messages, now);
  const sourceHash = input.messages.map((message) => `${message.id}:${message.contentHash}`).join("|");
  const enrich = input.enrich ?? input.mode === "deep";
  const previousGraph = await db.get("conversationGraphs", input.conversation.id);
  if (!input.force && !enrich && (previousGraph?.analysisMode !== "fast" || input.mode === "fast") && (!previousGraph?.analysisModelKey || previousGraph.analysisModelKey === modelKey) && previousGraph?.organizationMode === "ai" && !previousGraph.userEdited && previousGraph.sourceHash === sourceHash && previousGraph.analysisVersion === ANALYSIS_VERSION) {
    await recordAIUsage({ id: crypto.randomUUID(), createdAt: now, runId: input.runId ?? crypto.randomUUID(), taskType: "conversation_structure", providerId: input.provider.id ?? "custom", modelId: input.provider.modelId ?? "cached", conversationIds: [input.conversation.id], inputTokens: 0, outputTokens: 0, tokenSource: "provider", status: "cached", costCny: 0, attempt: 1, durationMs: 0 }).catch(() => undefined);
    input.onProgress?.("validation", 1, 1);
    return previousGraph;
  }
  const combinedPrompt = JSON.stringify({ conversation: { id: input.conversation.id, title: input.conversation.title }, questions: complete.map((item) => item.payload) });
  const combinedBudget = requestBudget({ system: "Read complete discussions", prompt: combinedPrompt, taskType: "conversation_structure" });
  const supportsCombined = input.provider.capabilities?.conversationStructure && (input.provider.id !== "atlas-demo" || (await atlasApiClient.getSession(input.signal, true)).features?.conversationStructure);
  const existingSnapshots = await db.getAllFromIndex("questionSnapshots", "by-conversation", input.conversation.id);
  const freshCount = complete.filter((item) => !existingSnapshots.some((snapshot) => snapshot.questionId === item.snapshot.questionId && snapshot.sourceHash === item.snapshot.sourceHash && snapshot.analysisSource === "ai" && snapshot.analysisVersion === ANALYSIS_VERSION && snapshot.analysisModelKey === modelKey)).length;
  if (!enrich && freshCount > complete.length / 2 && supportsCombined && complete.length > 0 && complete.length <= 24 && combinedBudget.inputTokens <= combinedBudget.maxInputTokens) {
    input.onProgress?.("questions", 0, complete.length);
    const request = { taskType: "conversation_structure" as const, conversationIds: [input.conversation.id], system: "Read the complete chronological discussion once, preserving corrections and continuous context.", prompt: combinedPrompt, validate: (value: unknown) => {
      const snapshots = validateSnapshots(value, complete.map((item) => item.snapshot));
      if (snapshots.some((snapshot) => snapshot.analysisSource !== "ai")) throw new Error("AI returned incomplete question analysis.");
      const structure = validateConversationChapterPlan(value, input.conversation, snapshots, { chapters: [], questionRelations: [] }, now);
      const profile = overviewFromPlan((value as { profile?: unknown }).profile, input.conversation, snapshots, modelKey, input.mode ?? "balanced", now);
      if (!profile) throw new Error("AI returned an incomplete conversation overview.");
      return { snapshots, structure: { ...structure, bridges: [], freeCards: [] }, profile };
    } };
    const result = await (input.provider.synthesize?.(request) ?? input.provider.generateStructured(request));
    input.signal?.throwIfAborted();
    await saveConversationMaterials(result.snapshots.map((snapshot) => ({ ...snapshot, analysisModelKey: modelKey, analysisMode: input.mode ?? "balanced" })), result.profile);
    input.onPartial?.(result.structure.chapters);
    const base = generateConversationGraph(input.conversation, input.messages, result.structure);
    const graph = { ...base, organizationMode: "ai" as const, sourceHash, analysisModelKey: modelKey, analysisMode: input.mode ?? "balanced", episodes: buildContextEpisodes(base.chapters ?? [], input.messages, result.structure.episodePlans), analysisVersion: ANALYSIS_VERSION, analyzedVersion: analyzedVersion(input.conversation) };
    input.onProgress?.("questions", complete.length, complete.length);
    input.onProgress?.("planning", 1, 1);
    input.onProgress?.("validation", 1, 1);
    await saveAnalysisDiagnostics({ id: crypto.randomUUID(), createdAt: now, runId: input.runId, questionsAnalyzed: complete.length, cachedQuestionsReused: 0, rawMessagesLoaded: input.messages.length, aiRequests: 1, estimatedInputTokens: combinedBudget.inputTokens, estimatedOutputTokens: 0, relationsVerified: 0, bridgesGenerated: 0, questionCount: complete.length, topicCount: result.structure.chapters.length, relationCount: 0, bridgeCount: 0, synthesisCalls: 1, compressionRatio: result.structure.chapters.length / complete.length });
    return graph;
  }
  const semantic = await ensureSemanticArtifacts({ conversations: [input.conversation], runId: input.runId, loadMessages: async () => input.messages, provider: input.provider, mode: input.mode, includeProfiles: false, requireAI: true, now, signal: input.signal,
    onQuestionProgress: (completed, total) => input.onProgress?.("questions", completed, total),
  });
  input.signal?.throwIfAborted();
  const snapshots = await (await getDatabase()).getAllFromIndex("questionSnapshots", "by-conversation", input.conversation.id);
  const questionOrder = new Map(input.messages.filter((message) => message.role === "user").map((message, index) => [message.id, index]));
  const ordered = snapshots.filter((snapshot) => questionOrder.has(snapshot.questionId)).sort((a, b) => (questionOrder.get(a.questionId) ?? 0) - (questionOrder.get(b.questionId) ?? 0));
  if (!ordered.length) throw new Error("No user questions are available for AI chapter organization.");
  // Explicit AI organization uses cached AI question snapshots and an AI chapter plan.
  // Local keyword grouping is not substituted for a short or failed AI request.
  const fallback: ConversationStructure = { chapters: [], questionRelations: [] };
  let structure: ConversationStructure;
  input.onProgress?.("planning", 0, 1);
  {
    const targetRange = ordered.length <= 3 ? "1–2" : ordered.length <= 12 ? "2–4" : ordered.length <= 25 ? "3–6" : "5–9";
    const prompt = JSON.stringify({ conversation: { id: input.conversation.id, title: input.conversation.title }, enrich: input.enrich ?? input.mode === "deep", questions: ordered.map((snapshot) => ({ id: snapshot.questionId, title: snapshot.displayTitle, summary: snapshot.summary, answer: snapshot.answerKeypoint?.slice(0, 160), concepts: snapshot.concepts, intent: snapshot.intent })), episodeBoundaryCandidates: suggestEpisodeBoundaries(ordered), target: `First infer the main thinking stages across the entire conversation, then assign every question to one stage. Produce roughly ${targetRange} chapters, fewer if topics overlap. Every question ID must appear exactly once. Each chapter must contain a contiguous span of the supplied questions; concatenating chapter questionIds must reproduce their original order exactly. When a theme returns later, describe the connection in the later chapter summary or a useful bridge rather than moving those turns into an earlier chapter. Preserve the user's questions and changes in understanding. Use concise 4–12-character noun-phrase titles, not questions or generic labels. Backbone is the chronological 0-based chapter order. The local episodeBoundaryCandidates are hints, never automatic splits; judge each boundary semantically. Split chapters into the smallest self-contained contiguous reading episodes without fragmenting follow-up chains. A complete one-question episode is allowed when the next discussion truly changes topic. All episodes of a chapter must reproduce its question IDs in order. Give each episode a short grounded summary and concepts for retrieval, while Reader displays the original messages. Add a short contextHeader only when an episode depends on earlier discussion; ground it in supplied question summaries and do not restate the whole conversation. Propose at most 3 short bridge explanations only where adjacent stages have a non-obvious relationship, and at most 2 insight/draft cards. Insight must synthesize at least two cited questions; draft asks for a missing user judgment and must not fabricate its answer. Candidates are optional: use empty arrays when nothing adds value.`, schema: { chapters: [{ title: "stage meaning as a short noun phrase", summary: "one specific sentence, no template text", questionIds: ["id"] }], backbone: [0, 1], episodes: [{ chapterOrder: 0, title: "contextual reading section", summary: "short grounded meaning", concepts: ["durable concept"], contextHeader: "optional short preceding context", questionIds: ["adjacent question ids"] }], bridgeCandidates: [{ fromOrder: 0, toOrder: 1, text: "why these stages connect", questionIds: ["evidence question ids from both stages"] }], freeCardCandidates: [{ afterOrder: 0, type: "insight | draft", title: "short title or user question", body: "only for insight; evidence-grounded synthesis", questionIds: ["evidence question id"] }] } });
    try {
      const request = {
        taskType: "chapter_planning" as const, conversationIds: [input.conversation.id],
        system: "Compose a reviewable structure from cached question snapshots. Preserve contiguous discussion and the user's path to understanding. Propose only sparse, useful explanatory and synthesis cards. Never invent questions, evidence, or user opinions. Return strict JSON.",
        prompt, validate: (value: unknown) => ({ structure: validateConversationChapterPlan(value, input.conversation, ordered, fallback, now), profile: overviewFromPlan((value as { profile?: unknown }).profile, input.conversation, ordered, modelKey, input.mode ?? "balanced", now) }),
      };
      const budget = requestBudget(request);
      let planned; let planningRecorded = false;
      const prefix = !enrich && !input.force && previousGraph?.analysisMode === (input.mode ?? "balanced") ? incrementalChapterPrefix(previousGraph, input.messages, ordered, sourceHash, modelKey) : undefined;
      if (prefix || ordered.length > 300 || budget.inputTokens > budget.maxInputTokens) {
        const value = await planLongConversation({ conversation: { id: input.conversation.id, title: input.conversation.title }, snapshots: ordered, provider: input.provider, signal: input.signal, ...prefix,
          onProgress: (completed, total) => input.onProgress?.("planning", completed, total),
          onPartial: (chapters) => input.onPartial?.(chapters.map((chapter, order) => ({ ...chapter, id: `partial-${input.conversation.id}-${order}`, conversationId: input.conversation.id, order, questionIds: chapter.questionIds.map((id) => `conversation-message-${id}`), collapsed: true, source: "auto", createdAt: now, updatedAt: now }))), onRequest: (input, output) => { semantic.diagnostics.aiRequests += 1; semantic.diagnostics.synthesisCalls = (semantic.diagnostics.synthesisCalls ?? 0) + 1; semantic.diagnostics.estimatedInputTokens += requestBudget({ taskType: "chapter_planning", system: "", prompt: input }).inputTokens; semantic.diagnostics.estimatedOutputTokens += JSON.stringify(output).length; } });
        planned = request.validate(value);
        planningRecorded = true;
      } else planned = await (input.provider.synthesize?.(request) ?? input.provider.generateStructured(request));
      structure = planned.structure;
      input.onPartial?.(structure.chapters);
      if (planned.profile) await db.put("semanticProfiles", planned.profile);
      if (!planningRecorded) {
        semantic.diagnostics.aiRequests += 1;
        semantic.diagnostics.synthesisCalls = (semantic.diagnostics.synthesisCalls ?? 0) + 1;
        semantic.diagnostics.estimatedInputTokens += budget.inputTokens;
        semantic.diagnostics.estimatedOutputTokens += Math.ceil(JSON.stringify(structure).length / 2);
      }
      structure = await judgeConversationComposition(enrich ? structure : { ...structure, bridges: [], freeCards: [] }, ordered, input.provider, (characters, output, failed) => { semantic.diagnostics.aiRequests += 1; semantic.diagnostics.decisionCalls = (semantic.diagnostics.decisionCalls ?? 0) + 1; semantic.diagnostics.estimatedInputTokens += Math.ceil(characters / 4); semantic.diagnostics.estimatedOutputTokens += Math.ceil(output / 4); if (failed) semantic.diagnostics.schemaFailures = (semantic.diagnostics.schemaFailures ?? 0) + 1; });
    } catch (error) { input.signal?.throwIfAborted(); semantic.diagnostics.aiRequests += 1; semantic.diagnostics.synthesisCalls = (semantic.diagnostics.synthesisCalls ?? 0) + 1; semantic.diagnostics.schemaFailures = (semantic.diagnostics.schemaFailures ?? 0) + 1; semantic.diagnostics.estimatedInputTokens += Math.ceil(prompt.length / 4); throw error; }
  }
  input.signal?.throwIfAborted();
  input.onProgress?.("planning", 1, 1);
  input.onProgress?.("validation", 0, 1);
  const graphBase = generateConversationGraph(input.conversation, input.messages, structure);
  const graph = { ...graphBase, organizationMode: "ai" as const, sourceHash, analysisModelKey: modelKey, analysisMode: input.mode ?? "balanced", episodes: buildContextEpisodes(graphBase.chapters ?? [], input.messages, structure.episodePlans), analysisVersion: ANALYSIS_VERSION, analyzedVersion: analyzedVersion(input.conversation) };
  semantic.diagnostics.topicCount = structure.chapters.length;
  semantic.diagnostics.relationCount = structure.questionRelations.filter((relation) => relation.type !== "continue").length + Math.max(0, structure.chapters.length - 1);
  semantic.diagnostics.bridgeCount = structure.bridges?.length ?? 0;
  semantic.diagnostics.compressionRatio = structure.chapters.length / Math.max(1, ordered.length);
  semantic.diagnostics.bridgesGenerated = structure.bridges?.length ?? 0;
  recordProviderUsage(semantic.diagnostics, usageBefore, input.provider.getUsageSnapshot?.());
  await saveAnalysisDiagnostics(semantic.diagnostics);
  input.signal?.throwIfAborted();
  input.onProgress?.("validation", 1, 1);
  return graph;
}

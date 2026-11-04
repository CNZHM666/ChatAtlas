import { executeBatches } from "./batch-executor";
import type { QuestionSnapshot } from "../shared/types";
import type { AtlasAIProvider, StructuredAIRequest } from "./provider";
import { requestBudget } from "./request-policy";
import { dependsOnEarlierContext } from "./episode-candidates";
import { AIProviderValidationError } from "./provider-errors";

type Chapter = { title: string; summary: string; questionIds: string[] };
export type ChapterBatchPlan = { chapters: Chapter[]; backbone: number[]; episodes: Array<{ chapterOrder: number; title: string; summary: string; questionIds: string[]; contextHeader?: string; concepts?: string[] }>; profile?: unknown; bridgeCandidates: unknown[]; freeCardCandidates: unknown[] };

const payload = (snapshot: QuestionSnapshot) => ({ id: snapshot.questionId, title: snapshot.displayTitle, summary: snapshot.summary.length <= 1500 ? snapshot.summary : snapshot.summary.split("\n").filter((_, index, lines) => index === 0 || index === lines.length - 1 || index % Math.max(1, Math.ceil(lines.length / 6)) === 0).map((line) => line.slice(0, 180)).join("\n").slice(0, 1500), concepts: snapshot.concepts.slice(0, 8), intent: snapshot.intent });

const MAX_PLAN_CHAPTERS = 9;

/** Chapters are contiguous spans of the supplied questions, in order. A reply that
 * drops, repeats or reorders a few IDs is repaired locally instead of failing the
 * whole long-conversation plan: an unclaimed question joins the chapter before it,
 * the original order decides the spans, and the smallest neighbours merge down to
 * the chapter limit. Only a reply without any usable chapter is refused. */
function validatePlan(value: unknown, ids: string[]): ChapterBatchPlan {
  const result = value && typeof value === "object" ? value as ChapterBatchPlan : undefined;
  const chapters = Array.isArray(result?.chapters) ? result!.chapters.filter((chapter) => chapter && typeof chapter.title === "string" && chapter.title.trim() && typeof chapter.summary === "string" && chapter.summary.trim() && Array.isArray(chapter.questionIds)) : [];
  const owner = new Map<string, number>();
  chapters.forEach((chapter, index) => { for (const id of chapter.questionIds) if (ids.includes(id) && !owner.has(id)) owner.set(id, index); });
  if (!owner.size) throw new AIProviderValidationError("chapter_plan_empty");
  // Walk the original order: a chapter never resumes after a later one began.
  let current = owner.get(ids.find((id) => owner.has(id))!)!;
  const spans: Array<{ chapter: number; questionIds: string[] }> = [];
  for (const id of ids) {
    const claimed = owner.get(id);
    if (claimed !== undefined && claimed > current) current = claimed;
    if (spans.at(-1)?.chapter === current) spans.at(-1)!.questionIds.push(id); else spans.push({ chapter: current, questionIds: [id] });
  }
  const repaired = spans.map((span) => ({ ...chapters[span.chapter], questionIds: span.questionIds }));
  while (repaired.length > MAX_PLAN_CHAPTERS) {
    // Merge the smallest adjacent pair; the earlier chapter keeps its title.
    let at = 0;
    for (let index = 1; index < repaired.length - 1; index++) if (repaired[index].questionIds.length + repaired[index + 1].questionIds.length < repaired[at].questionIds.length + repaired[at + 1].questionIds.length) at = index;
    repaired.splice(at, 2, { ...repaired[at], questionIds: [...repaired[at].questionIds, ...repaired[at + 1].questionIds] });
  }
  return { ...result!, chapters: repaired };
}

/** Long discussions get bounded stage plans followed by one compact outline plan.
 * Every question remains in order; Reader continues to display the original text.
 */
export async function planLongConversation(input: { conversation: { id: string; title: string }; snapshots: QuestionSnapshot[]; provider: AtlasAIProvider; signal?: AbortSignal; onRequest?: (input: string, output: unknown) => void; prefixChapters?: Chapter[]; prefixEpisodes?: ChapterBatchPlan["episodes"]; onPartial?: (chapters: Chapter[]) => void; onProgress?: (completed: number, total: number) => void }): Promise<ChapterBatchPlan> {
  let blocks: Chapter[] = [...input.prefixChapters ?? []];
  const episodes: ChapterBatchPlan["episodes"] = [...input.prefixEpisodes ?? []];
  const batches: Array<{ batch: QuestionSnapshot[]; precedingContext: Array<{ title: string; summary: string }> }> = [];
  for (let start = blocks.reduce((sum, block) => sum + block.questionIds.length, 0); start < input.snapshots.length;) {
    input.signal?.throwIfAborted();
    const batch: QuestionSnapshot[] = [];
    const precedingContext = input.snapshots.slice(Math.max(0, start - 2), start).map((snapshot) => ({ title: snapshot.displayTitle, summary: snapshot.summary.slice(-350) }));
    while (start + batch.length < input.snapshots.length && batch.length < 24) {
      const next = input.snapshots[start + batch.length];
      const prompt = JSON.stringify({ conversation: input.conversation, questions: [...batch, next].map(payload), enrich: false, precedingContext });
      if (batch.length && requestBudget({ taskType: "chapter_planning", system: "", prompt }).inputTokens > 18000) break;
      batch.push(next);
    }
    // Prefer a boundary before the next independent question; don't cut a short
    // follow-up chain merely to fill a batch to its maximum size.
    while (batch.length > 12 && start + batch.length < input.snapshots.length && dependsOnEarlierContext(input.snapshots[start + batch.length].displayTitle)) batch.pop();
    batches.push({ batch, precedingContext });
    start += batch.length;
  }
  const partialPlans: Array<ChapterBatchPlan | undefined> = new Array(batches.length);
  let completed = 0;
  input.onProgress?.(0, batches.length + 1);
  const plans = await executeBatches(batches, input.provider, async ({ batch, precedingContext }, batchIndex) => {
    const prompt = JSON.stringify({ conversation: input.conversation, questions: batch.map(payload), enrich: false, precedingContext, localPlan: true });
    const request: StructuredAIRequest<ChapterBatchPlan> = { taskType: "chapter_planning", conversationIds: [input.conversation.id], system: "Plan contiguous stages, preserving later corrections.", prompt, validate: (value) => validatePlan(value, batch.map((snapshot) => snapshot.questionId)) };
    const result = await (input.provider.synthesize?.(request) ?? input.provider.generateStructured(request));
    input.onRequest?.(prompt, result);
    partialPlans[batchIndex] = result;
    const ready = [...input.prefixChapters ?? []];
    for (const plan of partialPlans) { if (!plan) break; ready.push(...plan.chapters); }
    if (ready.length) input.onPartial?.(ready);
    input.onProgress?.(++completed, batches.length + 1);
    return result;
  }, input.signal);
  for (const result of plans) {
    for (const [index, chapter] of result.chapters.entries()) {
      const blockIndex = blocks.length; blocks.push(chapter);
      const supplied = result.episodes?.filter((episode) => episode.chapterOrder === index) ?? [];
      const assigned = supplied.flatMap((episode) => episode.questionIds ?? []);
      const valid = assigned.length === chapter.questionIds.length && assigned.every((id, position) => id === chapter.questionIds[position]) && supplied.every((episode) => typeof episode.title === "string" && typeof episode.summary === "string");
      episodes.push(...(valid ? supplied : [{ chapterOrder: index, title: chapter.title, summary: chapter.summary, questionIds: chapter.questionIds }]).map((episode) => ({ ...episode, chapterOrder: blockIndex })));
    }
  }
  input.signal?.throwIfAborted();
  const outlinePrompt = (group: Chapter[], localPlan = false) => JSON.stringify({ conversation: input.conversation, questions: group.map((block, index) => ({ id: `stage-${index}`, title: block.title.slice(0, 180), summary: block.summary.slice(0, 250) })), enrich: false, outlineOnly: true, ...(localPlan ? { localPlan: true } : {}) });
  const merge = async (group: Chapter[], localPlan = false) => {
    input.signal?.throwIfAborted();
    const ids = group.map((_, index) => `stage-${index}`);
    const prompt = outlinePrompt(group, localPlan);
    const request: StructuredAIRequest<ChapterBatchPlan> = { taskType: "chapter_planning", conversationIds: [input.conversation.id], system: "Merge stages into a compact chronological outline. Preserve all stage IDs in order.", prompt, validate: (value) => validatePlan(value, ids) };
    const outline = await (input.provider.synthesize?.(request) ?? input.provider.generateStructured(request));
    input.onRequest?.(prompt, outline);
    return { ...outline, chapters: outline.chapters.map((chapter) => ({ ...chapter, questionIds: chapter.questionIds.flatMap((id) => group[ids.indexOf(id)].questionIds) })) };
  };
  // A very long transcript also needs bounded intermediate outline merges.
  // Each merge retains the original question IDs; no source is dropped.
  while (blocks.length > 200 || requestBudget({ taskType: "chapter_planning", system: "", prompt: outlinePrompt(blocks) }).inputTokens > 18000) {
    const reduced: Chapter[] = [];
    const groups: Chapter[][] = [];
    for (let start = 0; start < blocks.length; start += 24) groups.push(blocks.slice(start, start + 24));
    for (const plan of await executeBatches(groups, input.provider, (group) => merge(group, true), input.signal)) reduced.push(...plan.chapters);
    blocks = reduced;
  }
  const outline = await merge(blocks);
  input.onProgress?.(batches.length + 1, batches.length + 1);
  const questionToChapter = new Map(outline.chapters.flatMap((chapter, index) => chapter.questionIds.map((id) => [id, index] as const)));
  return { ...outline, backbone: outline.chapters.map((_, index) => index), episodes: episodes.map((episode) => ({ ...episode, chapterOrder: questionToChapter.get(episode.questionIds[0])! })), bridgeCandidates: [], freeCardCandidates: [] };
}

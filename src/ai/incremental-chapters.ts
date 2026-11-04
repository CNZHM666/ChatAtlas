import type { ConversationGraph, ConversationMessage, QuestionSnapshot } from "../shared/types";
import type { ChapterBatchPlan } from "./chapter-batches";

// Ambiguous references and revisions require a full semantic pass over snapshots.
const revision = /纠正|更正|修正|不对|错误|推翻|改为|改成|实际上|之前|前面|上面|重新|不是.{0,24}而是|correction|incorrect|actually|instead|earlier|previous|revise|wrong/iu;

/** Reuse only an unchanged chronological prefix of an unedited AI structure.
 * Keep two old chapters in the active window; the final outline still reviews
 * summaries of every reused chapter, so the global reading order stays coherent.
 */
export function incrementalChapterPrefix(graph: ConversationGraph | undefined, messages: ConversationMessage[], snapshots: QuestionSnapshot[], sourceHash: string, modelKey: string) {
  if (!graph || graph.userEdited || graph.organizationMode !== "ai" || !graph.sourceHash || !sourceHash.startsWith(`${graph.sourceHash}|`) || graph.analysisModelKey !== modelKey || snapshots.length < 48) return undefined;
  const chapters = [...graph.chapters ?? []].sort((a, b) => a.order - b.order);
  if (chapters.length < 3) return undefined;
  const oldIds = chapters.flatMap((chapter) => chapter.questionIds.map((id) => id.replace(/^conversation-message-/u, "")));
  if (oldIds.some((id, index) => id !== snapshots[index]?.questionId) || oldIds.length >= snapshots.length) return undefined;
  const addedIds = new Set(snapshots.slice(oldIds.length).map((snapshot) => snapshot.questionId));
  const newMessages = messages.filter((message) => addedIds.has(message.id));
  const firstNew = Math.min(...newMessages.map((message) => message.messageIndex));
  if (!newMessages.length || messages.some((message) => message.messageIndex >= firstNew && revision.test(message.content))) return undefined;
  const reused = chapters.slice(0, -2);
  const questionCount = reused.reduce((sum, chapter) => sum + chapter.questionIds.length, 0);
  if (questionCount < 24) return undefined;
  const prefixChapters = reused.map((chapter) => ({ title: chapter.title, summary: chapter.summary ?? chapter.title, questionIds: chapter.questionIds.map((id) => id.replace(/^conversation-message-/u, "")) }));
  const prefixEpisodes: ChapterBatchPlan["episodes"] = reused.flatMap((chapter, chapterOrder) => {
    const episodes = graph.episodes?.filter((episode) => episode.chapterId === chapter.id) ?? [];
    return episodes.length ? episodes.map((episode) => ({ chapterOrder, title: episode.title, summary: episode.summary ?? chapter.summary ?? chapter.title, questionIds: episode.questionIds, contextHeader: episode.contextHeader, concepts: episode.concepts })) : [{ chapterOrder, ...prefixChapters[chapterOrder] }];
  });
  return { prefixChapters, prefixEpisodes, questionCount };
}

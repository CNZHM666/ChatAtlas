import type { ContextEpisode, ConversationChapter, ConversationMessage } from "../shared/types";

export interface EpisodePlan { chapterOrder: number; title: string; questionIds: string[]; contextHeader?: string; summary?: string; concepts?: string[] }

/** Keep AI boundaries only when they form an exact, ordered partition of each chapter. */
export function buildContextEpisodes(chapters: ConversationChapter[], messages: ConversationMessage[], plans: EpisodePlan[] = []): ContextEpisode[] {
  const orderedMessages = [...messages].sort((a, b) => a.messageIndex - b.messageIndex);
  const orderedChapters = [...chapters].sort((a, b) => a.order - b.order);
  const questionPosition = new Map(orderedMessages.map((message, index) => [message.id, index]));
  const episodes: ContextEpisode[] = [];
  for (const [chapterIndex, chapter] of orderedChapters.entries()) {
    const rawIds = chapter.questionIds.map((id) => id.replace(/^conversation-message-/u, ""));
    const candidate = plans.filter((plan) => plan.chapterOrder === chapter.order);
    const valid = candidate.length > 0 && candidate.every((plan) => plan.title.trim() && plan.questionIds.length) && !(candidate.length > 2 && candidate.every((plan) => plan.questionIds.length === 1)) && candidate.flatMap((plan) => plan.questionIds).join("\u0000") === rawIds.join("\u0000");
    // An untrusted or missing semantic split should not break a follow-up chain
    // at an arbitrary message count. Keep the chapter intact for local reading.
    const groups = valid ? candidate : [{ title: chapter.title, questionIds: rawIds }];
    for (const [index, group] of groups.entries()) {
      const first = questionPosition.get(group.questionIds[0]);
      const nextQuestion = groups[index + 1]?.questionIds[0] ?? orderedChapters[chapterIndex + 1]?.questionIds[0]?.replace(/^conversation-message-/u, "");
      const end = nextQuestion ? questionPosition.get(nextQuestion) : orderedMessages.length;
      const messageIds = first === undefined ? [] : orderedMessages.slice(first, end === undefined ? orderedMessages.length : end).map((message) => message.id);
      const header = "contextHeader" in group && typeof group.contextHeader === "string" && (chapter.order > 0 || index > 0) ? group.contextHeader.trim().slice(0, 160) : "";
      const sourceHash = first === undefined ? "" : orderedMessages.slice(first, end === undefined ? orderedMessages.length : end).map((message) => message.contentHash).join(":");
      episodes.push({ id: `${chapter.id}-episode-${group.questionIds[0]}`, chapterId: chapter.id, conversationId: chapter.conversationId, title: group.title.trim().slice(0, 80), ...(header ? { contextHeader: header } : {}), ...("summary" in group && typeof group.summary === "string" && group.summary.trim() ? { summary: group.summary.trim().slice(0, 240) } : {}), ...("concepts" in group && Array.isArray(group.concepts) ? { concepts: group.concepts.filter((item): item is string => typeof item === "string").slice(0, 8) } : {}), questionIds: group.questionIds, messageIds, sourceHash, analysisVersion: 1 });
    }
  }
  return episodes;
}

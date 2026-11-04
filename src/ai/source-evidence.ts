import type { ConversationMessage } from "../shared/types";
import { indexAnswersByQuestion } from "../canvas/conversation-graph";
import { intentTerms } from "./knowledge-source-retrieval";

export type SourceExcerpt = { messageId: string; role: string; start: number; text: string };

/** Retrieve bounded original evidence rather than auditing one generated summary with another. */
export function sourceExcerpts(messages: ConversationMessage[], query: string, questionId?: string): SourceExcerpt[] {
  const ordered = [...messages].sort((a, b) => a.messageIndex - b.messageIndex);
  const answers = indexAnswersByQuestion(ordered);
  const selectedIds = questionId ? new Set([questionId, ...(answers.get(questionId) ?? []).map((message) => message.id)]) : undefined;
  const terms = intentTerms(query);
  const chunks = ordered.filter((message) => !selectedIds || selectedIds.has(message.id)).flatMap((message) => {
    const result: Array<SourceExcerpt & { score: number; order: number }> = [];
    for (let start = 0; start < message.content.length; start += 550) {
      const text = message.content.slice(start, start + 700);
      result.push({ messageId: message.id, role: message.role, start, text, order: message.messageIndex, score: terms.reduce((score, term) => score + Number(text.toLocaleLowerCase().includes(term)), 0) });
    }
    return result;
  });
  return chunks.sort((a, b) => b.score - a.score || b.order - a.order || b.start - a.start).slice(0, 2).sort((a, b) => a.order - b.order || a.start - b.start).map(({ messageId, role, start, text }) => ({ messageId, role, start, text }));
}

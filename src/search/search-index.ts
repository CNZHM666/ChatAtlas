import type { CanvasCard, Conversation, ConversationMessage, MessageAnchor } from "../shared/types";
import { searchScore } from "./query";
import type { ReviewMark } from "../storage/review-marks";
import type { MessageSourceRange } from "../shared/message-location";

export type SearchResult = { excerpt?: string; sourceRange?: MessageSourceRange } & (
  | { kind: "card"; id: string; canvasId?: string; title: string; context: string; score: number }
  | { kind: "conversation"; id: string; title: string; context: string; score: number }
  | { kind: "anchor"; id: string; title: string; context: string; score: number }
  | { kind: "mark"; id: string; cardId: string; canvasId: string; messageId: string; title: string; context: string; score: number }
  | { kind: "message"; id: string; title: string; context: string; score: number; message: ConversationMessage; questionId?: string }
  | { kind: "section" | "note"; id: string; sessionId: string; sectionId: string; title: string; context: string; score: number });


function rank(query: string, fields: string[]): number {
  return query.trim() ? searchScore(query, fields.join(" "), true) : 1;
}

export function searchAtlas(
  query: string,
  source: { cards: CanvasCard[]; conversations: Conversation[]; anchors: MessageAnchor[]; marks?: ReviewMark[] },
): SearchResult[] {
  const results: SearchResult[] = [];

  for (const card of source.cards) {
    const score = rank(query, [card.title, card.description ?? "", card.notes ?? "", ...card.tags]);
    if (score) results.push({ kind: "card", id: card.id, canvasId: card.canvasId, title: card.title, context: card.homeCanvasId ?? card.description ?? "Concept", score });
  }
  for (const conversation of source.conversations) {
    const score = rank(query, [conversation.title, conversation.summary ?? "", ...(conversation.tags ?? [])]);
    if (score) results.push({ kind: "conversation", id: conversation.id, title: conversation.title, context: "Conversation", score });
  }
  for (const anchor of source.anchors) {
    const score = rank(query, [anchor.preview]);
    if (score) results.push({ kind: "anchor", id: anchor.id, title: anchor.preview, context: "Message", score });
  }
  for (const mark of source.marks ?? []) {
    const score = rank(query, [mark.originalText, mark.updateNote]);
    if (score) results.push({ kind: "mark", id: mark.id, cardId: mark.cardId, canvasId: mark.canvasId, messageId: mark.messageId, title: mark.originalText.slice(0, 100), context: mark.kind === "decision" ? "Decision" : "Conclusion", score: score + 3 });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 20);
}

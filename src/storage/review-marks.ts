import type { ConversationMessage } from "../shared/types";
import { getDatabase } from "./db";

export interface ReviewMark {
  id: string;
  cardId: string;
  canvasId: string;
  conversationId: string;
  messageId: string;
  kind: "conclusion" | "decision";
  originalText: string;
  updateNote: string;
  createdAt: number;
  updatedAt: number;
}

export async function listReviewMarks(cardId?: string): Promise<ReviewMark[]> {
  const db = await getDatabase();
  return cardId ? db.getAllFromIndex("reviewMarks", "by-card", cardId) : db.getAll("reviewMarks");
}

export async function markDiscussion(cardId: string, canvasId: string, message: ConversationMessage, kind: ReviewMark["kind"]): Promise<ReviewMark> {
  const db = await getDatabase();
  const id = `${cardId}:${message.id}:${kind}`;
  const existing = await db.get("reviewMarks", id);
  if (existing) return existing;
  const now = Date.now();
  const mark: ReviewMark = { id, cardId, canvasId, conversationId: message.conversationId, messageId: message.id, kind, originalText: message.content, updateNote: "", createdAt: now, updatedAt: now };
  await db.put("reviewMarks", mark);
  return mark;
}

export async function saveReviewMark(mark: ReviewMark): Promise<void> {
  await (await getDatabase()).put("reviewMarks", { ...mark, updatedAt: Date.now() });
}

export async function deleteReviewMark(id: string): Promise<void> {
  await (await getDatabase()).delete("reviewMarks", id);
}

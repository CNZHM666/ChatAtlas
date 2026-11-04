import type { FocusSession } from "../shared/focus-session";
import type { ConversationMessage } from "../shared/types";
import { sourceMessageSignature } from "../shared/source-signature";
import { isInternalSearchQueryMessage } from "../shared/conversation-text";
import { getDatabase } from "../storage/db";

export interface SourceChange { conversationId: string; added: number; changed: number; removed: number; unknown: boolean; reordered?: boolean; affectedChapterTitles?: string[] }
export function sourceChange(session: FocusSession, conversationId: string, messages: ConversationMessage[]): SourceChange {
  const saved = session.sourceSignatures?.[conversationId] ?? session.sourceOutlines?.find((item) => item.conversationId === conversationId)?.messageSignatures;
  if (!saved) return { conversationId, added: 0, changed: 0, removed: 0, unknown: true };
  const current = new Map(messages.filter((item) => item.content.trim() && !isInternalSearchQueryMessage(item)).map((item) => [item.id, sourceMessageSignature(item.content)]));
  const outline = session.sourceOutlines?.find((item) => item.conversationId === conversationId);
  const roles = session.sourceRoles?.[conversationId] ?? outline?.messageRoles;
  const readable = messages.filter(item => item.content.trim() && !isInternalSearchQueryMessage(item)).sort((a, b) => a.messageIndex - b.messageIndex);
  const changed = [...current].filter(([id, signature]) => id in saved && (saved[id] !== signature || roles?.[id] !== undefined && roles[id] !== readable.find(item => item.id === id)?.role)).map(([id]) => id);
  const oldOrder = session.sourceMessageOrder?.[conversationId] ?? outline?.messageOrder;
  const reordered = oldOrder ? oldOrder.filter(id => current.has(id)).join("\0") !== readable.filter(item => idInSaved(item.id)).map(item => item.id).join("\0") : false;
  function idInSaved(id: string) { return Object.hasOwn(saved!, id); }
  const removed = Object.keys(saved).filter((id) => !current.has(id));
  const affected = new Set([...changed, ...removed]);
  const titles = outline?.chapters.filter((chapter) => chapter.messageIds.some((id) => affected.has(id))).map((chapter) => chapter.title)
    ?? session.sections.filter((section) => session.evidence.some((item) => item.conversationId === conversationId && affected.has(item.messageId) && section.evidenceIds.includes(item.id))).map((section) => section.title);
  return { conversationId, added: [...current.keys()].filter((id) => !(id in saved)).length, changed: changed.length, removed: removed.length, unknown: false, ...(reordered ? { reordered } : {}), affectedChapterTitles: [...new Set(titles)] };
}
export async function sourceChanges(session: FocusSession): Promise<SourceChange[]> {
  const db = await getDatabase();
  return Promise.all(session.sourceConversationIds.map(async (id) => sourceChange(session, id, await db.getAllFromIndex("messages", "by-conversation", id))));
}

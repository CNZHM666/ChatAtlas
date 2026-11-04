import type { ConversationMessage } from "../shared/types";
import type { FocusSession } from "../shared/focus-session";
import { chapterEvidence } from "../shared/evidence-identity";

export interface ReaderCitation { sessionId: string; sectionId: string; section: string; project: string }

/** Saved chapters that cite each original message, so Reader can lead back to the knowledge built on it. */
export function readerCitations(conversationId: string, messages: ConversationMessage[], sessions: FocusSession[]): Map<string, ReaderCitation[]> {
  const result = new Map<string, ReaderCitation[]>();
  const byId = new Map<string, string>();
  for (const message of messages) { byId.set(message.id, message.id); if (message.platformMessageId) byId.set(message.platformMessageId, message.id); }
  for (const session of sessions) {
    if (session.deletedAt || session.ledgerTest || session.status === "preview") continue;
    for (const section of session.sections) {
      for (const ref of chapterEvidence(session, section)) {
        const id = ref.conversationId === conversationId ? byId.get(ref.messageId) : undefined;
        if (!id) continue;
        const list = result.get(id) ?? [];
        if (!list.some(item => item.sessionId === session.id && item.sectionId === section.id)) list.push({ sessionId: session.id, sectionId: section.id, section: section.title, project: session.title });
        result.set(id, list);
      }
    }
  }
  return result;
}

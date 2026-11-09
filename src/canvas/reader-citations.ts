import type { ConversationMessage } from "../shared/types";
import type { FocusSession } from "../shared/focus-session";
import { chapterEvidence } from "../shared/evidence-identity";

export interface ReaderCitation { sessionId: string; sectionId: string; section: string; project: string }

/** Saved chapters that cite each original message, so Reader can lead back to the knowledge built on it. */
export function readerCitations(conversationId: string, messages: ConversationMessage[], sessions: FocusSession[]): Map<string, ReaderCitation[]> {
  const result = new Map<string, ReaderCitation[]>();
  const byId = new Map<string, string>();
  for (const message of messages) { byId.set(message.id, message.id); if (message.platformMessageId) byId.set(message.platformMessageId, message.id); }
  // Each regeneration saves a new version of the project. Only the newest version of a project leads anywhere,
  // and a chapter is offered once, so a message cited by every version does not list the same chapter over and over.
  const projects = new Set<string>();
  const current = sessions.filter(session => !session.deletedAt && !session.ledgerTest && session.status !== "preview")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter(session => !projects.has(session.title) && Boolean(projects.add(session.title)));
  for (const session of current) {
    for (const section of session.sections) {
      for (const ref of chapterEvidence(session, section)) {
        const id = ref.conversationId === conversationId ? byId.get(ref.messageId) : undefined;
        if (!id) continue;
        const list = result.get(id) ?? [];
        if (!list.some(item => item.project === session.title && (item.sectionId === section.id || item.section === section.title))) list.push({ sessionId: session.id, sectionId: section.id, section: section.title, project: session.title });
        result.set(id, list);
      }
    }
  }
  return result;
}

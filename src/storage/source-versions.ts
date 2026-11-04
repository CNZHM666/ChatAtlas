import type { ConversationMessage } from "../shared/types";
import type { FocusSession } from "../shared/focus-session";
import { sourceMessageSignature } from "../shared/source-signature";
import { getDatabase } from "./db";
import { getMessagesForConversation } from "./messages";

export interface SourceVersion { id: string; conversationId: string; fingerprint: string; messages: ConversationMessage[]; capturedAt: number }
export function sourceVersion(conversationId: string, messages: ConversationMessage[], capturedAt: number): SourceVersion {
  const ordered = [...messages].sort((a, b) => a.messageIndex - b.messageIndex);
  const fingerprint = sourceMessageSignature(JSON.stringify(ordered.map(message => [message.id, message.role, message.messageIndex, message.content, message.replyToMessageId ?? "", ...(message.uiParts?.length ? [message.uiParts] : [])])));
  return { id: JSON.stringify([conversationId, fingerprint]), conversationId, fingerprint, messages: ordered, capturedAt };
}

/** Immutable originals; identical captures reuse a version, never replace its date or text. */
export async function retainSourceVersions(messages: ConversationMessage[]): Promise<Record<string, string>> {
  const db = await getDatabase(), tx = db.transaction("sourceVersions", "readwrite");
  const versions = [...new Set(messages.map(message => message.conversationId))].map(id => sourceVersion(id, messages.filter(message => message.conversationId === id), Date.now()));
  for (const version of versions) if (!await tx.store.get(version.id)) await tx.store.add(version);
  await tx.done;
  return Object.fromEntries(versions.map(version => [version.conversationId, version.id]));
}

export async function readSessionSource(session: FocusSession, conversationId: string, messageId?: string, sourceVersionId?: string): Promise<ConversationMessage[]> {
  const db = await getDatabase();
  const claimVersions = [...new Set(session.evidence.filter(ref => ref.conversationId === conversationId && ref.messageId === messageId).flatMap(ref => ref.sourceVersionId ? [ref.sourceVersionId] : []))];
  const retainedId = sourceVersionId ?? (claimVersions.length === 1 ? claimVersions[0] : undefined) ?? session.sourceVersionIds?.[conversationId];
  if (retainedId) {
    const retained = await db.get("sourceVersions", retainedId);
    return retained?.conversationId === conversationId ? retained.messages : [];
  }
  const signatures = session.sourceSignatures?.[conversationId] ?? session.sourceOutlines?.find(outline => outline.conversationId === conversationId)?.messageSignatures;
  const roles = session.sourceRoles?.[conversationId];
  const order = session.sourceMessageOrder?.[conversationId];
  const matches = (messages: ConversationMessage[]) => !signatures || Object.entries(signatures).every(([id, signature]) => messages.some(message => message.id === id && sourceMessageSignature(message.content) === signature && (!roles?.[id] || roles[id] === message.role))) && (!order || JSON.stringify(messages.filter(message => order.includes(message.id)).map(message => message.id)) === JSON.stringify(order));
  const current = await getMessagesForConversation(conversationId);
  if (matches(current)) return current;
  const versions = await db.getAllFromIndex("sourceVersions", "by-conversation", conversationId);
  return versions.sort((a, b) => b.capturedAt - a.capturedAt).find(version => matches(version.messages))?.messages ?? [];
}

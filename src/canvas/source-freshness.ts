import type { FocusSession } from "../shared/focus-session";
import type { ConversationMessage } from "../shared/types";
import { sourceMessageSignature } from "../shared/source-signature";
import { comparableSourceText, readableSourceMessages, sourceMessageDelta } from "../shared/source-message-delta";
import { getDatabase } from "../storage/db";
import { isCurrentHydrationComplete } from "../sync/import-state";

export interface SourceChange { conversationId: string; added: number; changed: number; removed: number; unknown: boolean; reordered?: boolean; affectedChapterTitles?: string[]; fingerprint?: string }
export const hasSourceChange = (change: SourceChange) => Boolean(change.added || change.changed || change.removed || change.reordered);

export function sourceChangeLabels(change: Omit<SourceChange, "conversationId" | "unknown">, zh: boolean) {
  return [
    change.added ? zh ? `新增 ${change.added} 条` : `${change.added} added` : "",
    change.changed ? zh ? `修改 ${change.changed} 条` : `${change.changed} edited` : "",
    change.removed ? zh ? `缺失 ${change.removed} 条` : `${change.removed} missing` : "",
    change.reordered ? zh ? "顺序变化" : "Order changed" : "",
  ].filter(Boolean);
}

export function sourceChangeDetails(session: FocusSession, conversationId: string, messages: ConversationMessage[], retained?: ConversationMessage[]) {
  const outline = session.sourceOutlines?.find(item => item.conversationId === conversationId);
  const originals = retained && readableSourceMessages(retained);
  const signatures = originals ? Object.fromEntries(originals.map(item => [item.id, sourceMessageSignature(item.content)]))
    : session.sourceSignatures?.[conversationId] ?? outline?.messageSignatures;
  const empty = { addedIds: [], changedIds: [], changedOriginalIds: [], removedIds: [], reordered: false, reorderedIds: undefined };
  if (!signatures) return { ...empty, unknown: true };
  const order = originals?.map(item => item.id) ?? session.sourceMessageOrder?.[conversationId] ?? outline?.messageOrder;
  const roles = originals ? undefined : session.sourceRoles?.[conversationId] ?? outline?.messageRoles;
  return { ...sourceMessageDelta(messages, signatures, roles, order, retained), unknown: false };
}

export function sourceChange(session: FocusSession, conversationId: string, messages: ConversationMessage[], retained?: ConversationMessage[]): SourceChange {
  const { addedIds, changedIds, changedOriginalIds, removedIds, reordered, reorderedIds, unknown } = sourceChangeDetails(session, conversationId, messages, retained);
  let fingerprint: string | undefined;
  if (addedIds.length || changedIds.length || removedIds.length || reordered) {
    const current = new Map(messages.map(message => [message.id, message]));
    const describe = (id: string, savedId: string) => {
      const message = current.get(id)!;
      return [savedId, message.role, sourceMessageSignature(comparableSourceText(message))];
    };
    fingerprint = sourceMessageSignature(JSON.stringify([
      addedIds.map(id => describe(id, id)),
      changedIds.map((id, index) => describe(id, changedOriginalIds[index])),
      removedIds.slice().sort(), reorderedIds,
    ]));
  }
  const affected = new Set([...changedOriginalIds, ...removedIds]);
  const outline = session.sourceOutlines?.find(item => item.conversationId === conversationId);
  const titles = outline?.chapters.filter(chapter => chapter.messageIds.some(id => affected.has(id))).map(chapter => chapter.title)
    ?? session.sections?.filter(section => session.evidence.some(item => item.conversationId === conversationId && affected.has(item.messageId) && section.evidenceIds.includes(item.id))).map(section => section.title);
  return { conversationId, added: addedIds.length, changed: changedIds.length, removed: removedIds.length, unknown,
    ...(reordered ? { reordered } : {}), ...(fingerprint ? { fingerprint } : {}), affectedChapterTitles: [...new Set(titles)] };
}

export async function loadSourceBaseline(session: FocusSession, conversationId: string) {
  const versionId = session.sourceVersionIds?.[conversationId];
  if (!versionId) return undefined;
  const version = await (await getDatabase()).get("sourceVersions", versionId);
  return version?.conversationId === conversationId ? version.messages : undefined;
}

export async function currentSourceChange(session: FocusSession, conversationId: string): Promise<SourceChange> {
  const db = await getDatabase();
  const tx = db.transaction(["conversations", "messages"], "readonly");
  const [conversation, messages] = await Promise.all([
    tx.objectStore("conversations").get(conversationId),
    tx.objectStore("messages").index("by-conversation").getAll(conversationId),
  ]);
  if (conversation && !isCurrentHydrationComplete(conversation)) {
    return { conversationId, added: 0, changed: 0, removed: 0, unknown: false };
  }
  const result = sourceChange(session, conversationId, messages);
  // Older summaries may only store signatures for the selected material. Check their saved
  // original transcript before calling the rest of the same conversation new.
  if (!session.sourceVersionIds?.[conversationId] || session.scope?.kind !== "goal" && !result.unknown && !hasSourceChange(result)) return result;
  const retained = await loadSourceBaseline(session, conversationId);
  return retained ? sourceChange(session, conversationId, messages, retained) : result;
}

export function sourceChanges(session: FocusSession): Promise<SourceChange[]> {
  return Promise.all(session.sourceConversationIds.map(id => currentSourceChange(session, id)));
}

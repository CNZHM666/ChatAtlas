import type { FocusSession } from "../shared/focus-session";
import { sourceMessageSignature } from "../shared/source-signature";
import { isInternalSearchQueryMessage } from "../shared/conversation-text";
import { getMessagesForConversation } from "../storage/messages";

/** Publish only against the raw material actually read, including role/order changes. */
export async function verifyFocusSources(session: FocusSession, signal: AbortSignal): Promise<void> {
  for (const id of session.sourceConversationIds) {
    signal.throwIfAborted();
    const ids = session.scope?.kind === "goal" ? new Set(session.scope.blocks?.filter(block => block.conversationId === id).flatMap(block => block.messageIds) ?? []) : undefined;
    const current = (await getMessagesForConversation(id, { cache: false })).filter(message => message.content.trim() && !isInternalSearchQueryMessage(message) && (!ids || ids.has(message.id)));
    const before = (session.sourceMessageOrder?.[id] ?? Object.keys(session.sourceSignatures?.[id] ?? {})).filter(messageId => !ids || ids.has(messageId));
    if (JSON.stringify(before) !== JSON.stringify(current.map(message => message.id)) || current.some(message => session.sourceSignatures?.[id]?.[message.id] !== sourceMessageSignature(message.content) || session.sourceRoles?.[id]?.[message.id] !== message.role)) throw new Error(session.locale === "en" ? "Original sources changed during analysis. Retry; your saved version is retained." : "原始讨论在分析期间变化，请重试；已保存版本保留。");
  }
  signal.throwIfAborted();
}

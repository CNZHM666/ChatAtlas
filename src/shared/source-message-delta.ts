import { isInternalSearchQueryMessage, withoutPlatformCitations } from "./conversation-text";
import { sourceMessageSignature } from "./source-signature";
import type { ConversationMessage } from "./types";

export function readableSourceMessages(messages: readonly ConversationMessage[]) {
  return messages.filter(message => message.content.trim() && !isInternalSearchQueryMessage(message))
    .sort((a, b) => a.messageIndex - b.messageIndex);
}

export function comparableSourceText(message: ConversationMessage) {
  const text = message.content.replace(/\r\n?/gu, "\n");
  // Platform citation tokens can appear or disappear when the same answer is captured from a different surface.
  return (message.role === "assistant" ? withoutPlatformCitations(text) : text).replace(/^\n+|\s+$/gu, "");
}

export function sameSourceText(previous: ConversationMessage, current: ConversationMessage) {
  return previous.role === current.role && (previous.content === current.content || comparableSourceText(previous) === comparableSourceText(current));
}

function uniqueBy(messages: ConversationMessage[], key: (message: ConversationMessage) => string | undefined) {
  const unique = new Map<string, ConversationMessage>();
  const duplicates = new Set<string>();
  for (const message of messages) {
    const identity = key(message);
    if (!identity || duplicates.has(identity)) continue;
    if (unique.has(identity)) { unique.delete(identity); duplicates.add(identity); }
    else unique.set(identity, message);
  }
  return unique;
}

export function sourceMessageDelta(
  messages: readonly ConversationMessage[],
  signatures: Record<string, string>,
  roles?: Record<string, string>,
  order?: string[],
  originals: readonly ConversationMessage[] = [],
) {
  const originalById = new Map(originals.map(message => [message.id, message]));
  const current = readableSourceMessages(messages).filter(message => {
    const old = originalById.get(message.id);
    return !old || !isInternalSearchQueryMessage(old) || !sameSourceText(old, message);
  });
  const currentById = new Map(current.map(message => [message.id, message]));
  const rawById = new Map(messages.map(message => [message.id, message]));
  const savedIds = Object.keys(signatures);
  const remainingOld = originals.filter(message => Object.hasOwn(signatures, message.id) && !currentById.has(message.id));
  const remainingNew = current.filter(message => !Object.hasOwn(signatures, message.id));
  const aliases = new Map<string, string>();
  const matched = new Set<string>();
  const pair = (key: (message: ConversationMessage) => string | undefined, compatible: (old: ConversationMessage, next: ConversationMessage) => boolean) => {
    const oldIndex = uniqueBy(remainingOld.filter(message => !matched.has(message.id)), key);
    const newIndex = uniqueBy(remainingNew.filter(message => !aliases.has(message.id)), key);
    for (const [identity, next] of newIndex) {
      const old = oldIndex.get(identity);
      if (old && compatible(old, next)) { aliases.set(next.id, old.id); matched.add(old.id); }
    }
  };
  pair(message => message.platformMessageId, () => true);
  pair(message => JSON.stringify([message.role, comparableSourceText(message)]), (old, next) => !old.platformMessageId || !next.platformMessageId);
  const addedIds: string[] = [], changedIds: string[] = [], currentOrder: string[] = [];
  for (const message of current) {
    const id = aliases.get(message.id) ?? message.id;
    if (!Object.hasOwn(signatures, id)) { addedIds.push(message.id); continue; }
    currentOrder.push(id);
    const old = originalById.get(id), role = roles?.[id] ?? old?.role;
    if (role && role !== message.role || signatures[id] !== sourceMessageSignature(message.content) && !(old && sameSourceText(old, message))) changedIds.push(message.id);
  }
  const removedIds = savedIds.filter(id => {
    if (currentById.has(id) || matched.has(id)) return false;
    const raw = rawById.get(id), old = originalById.get(id);
    // Capture adapters can start labelling an existing transport message without changing its text.
    return !raw || !isInternalSearchQueryMessage(raw) || !(sourceMessageSignature(raw.content) === signatures[id] || old && sameSourceText(old, raw));
  });
  const present = new Set(currentOrder), baselineOrder = order?.filter(id => present.has(id));
  const orderedIds = baselineOrder && new Set(baselineOrder);
  const relativeOrder = orderedIds ? currentOrder.filter(id => orderedIds.has(id)) : undefined;
  const reordered = Boolean(baselineOrder && relativeOrder && baselineOrder.join("\0") !== relativeOrder.join("\0"));
  const changedOriginalIds = changedIds.map(id => aliases.get(id) ?? id);
  return { addedIds, changedIds, changedOriginalIds, removedIds, reordered, reorderedIds: reordered ? relativeOrder : undefined };
}

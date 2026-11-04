import type { ConversationMessage } from "../shared/types";

interface ReaderCacheEntry { promise: Promise<ConversationMessage[]>; characters: number }
const cache = new Map<string, ReaderCacheEntry>();
const MAX_ENTRIES = 12;
const MAX_CHARACTERS = 8_000_000;
let characters = 0;

function remove(id: string): void {
  characters -= cache.get(id)?.characters ?? 0;
  cache.delete(id);
}

export function cachedReaderMessages(conversationId: string, load: () => Promise<ConversationMessage[]>): Promise<ConversationMessage[]> {
  const existing = cache.get(conversationId);
  if (existing) {
    cache.delete(conversationId);
    cache.set(conversationId, existing);
    return existing.promise;
  }
  const entry: ReaderCacheEntry = { promise: Promise.resolve([]), characters: 0 };
  entry.promise = load().then((messages) => {
    // A late response must not revive data invalidated by a newer import.
    if (cache.get(conversationId) === entry) {
      // An early read before hydration must not pin an empty discussion.
      if (!messages.length) { remove(conversationId); return messages; }
      entry.characters = messages.reduce((total, message) => total + message.content.length + message.preview.length, 0);
      characters += entry.characters;
      while (characters > MAX_CHARACTERS && cache.size) remove(cache.keys().next().value!);
    }
    return messages;
  }).catch((error: unknown) => {
    if (cache.get(conversationId) === entry) remove(conversationId);
    throw error;
  });
  cache.set(conversationId, entry);
  if (cache.size > MAX_ENTRIES) remove(cache.keys().next().value!);
  return entry.promise;
}

export function invalidateMessageReadCache(conversationId?: string): void {
  if (conversationId) remove(conversationId);
  else { cache.clear(); characters = 0; }
}

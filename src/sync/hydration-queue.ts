import type { Conversation } from "../shared/types";

/** User-requested items first, then recent conversations, without changing graph or message order. */
export function orderHydrationQueue(ids: string[], conversations: Conversation[], priorityIds: string[] = [], now = Date.now()): string[] {
  const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const requested = new Map(priorityIds.map((id, index) => [id, index]));
  const recency = (id: string) => {
    const conversation = byId.get(id);
    const at = conversation?.sourceUpdatedAt ?? conversation?.sourceCreatedAt ?? 0;
    return at >= now - 30 * 86_400_000 ? 2 : at >= now - 365 * 86_400_000 ? 1 : 0;
  };
  return [...new Set(ids)].sort((a, b) => {
    const aRequested = requested.get(a);
    const bRequested = requested.get(b);
    if (aRequested !== undefined || bRequested !== undefined) return aRequested === undefined ? 1 : bRequested === undefined ? -1 : aRequested - bRequested;
    return recency(b) - recency(a) || (byId.get(b)?.sourceUpdatedAt ?? 0) - (byId.get(a)?.sourceUpdatedAt ?? 0);
  });
}

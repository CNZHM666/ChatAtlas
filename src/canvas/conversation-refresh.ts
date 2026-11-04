import type { Conversation } from "../shared/types";

/** IndexedDB returns new objects even when no metadata changed. */
export function reconcileConversations(current: Conversation[], incoming: Conversation[]): Conversation[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  const next = incoming.map((item) => {
    const old = byId.get(item.id);
    if (!old) return item;
    const keys = new Set([...Object.keys(old), ...Object.keys(item)]);
    const unchanged = [...keys].every((key) => {
      const a = old[key as keyof Conversation], b = item[key as keyof Conversation];
      return a === b || Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);
    });
    return unchanged ? old : item;
  });
  return next.length === current.length && next.every((item, index) => item === current[index]) ? current : next;
}

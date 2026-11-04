import type { ConversationGraph } from "../shared/types";

export type UnderstandingRoute = NonNullable<ConversationGraph["understandingRoute"]>;

/** Preserve the source's chapter order. Only user cards can move between them. */
export function understandingRoute(chapters: string[], cards: string[], saved: UnderstandingRoute = []): UnderstandingRoute {
  const chapterSet = new Set(chapters), remaining = new Set(cards);
  const anchored = new Map<string, UnderstandingRoute>();
  let anchor = "";
  for (const entry of saved) {
    if (entry.kind === "chapter" && chapterSet.has(entry.id)) anchor = entry.id;
    if (entry.kind !== "card" || !remaining.delete(entry.id)) continue;
    const group = anchored.get(anchor) ?? [];
    group.push(entry); anchored.set(anchor, group);
  }
  return [...(anchored.get("") ?? []), ...chapters.flatMap((id) => [{ kind: "chapter" as const, id }, ...(anchored.get(id) ?? [])]), ...[...remaining].map((id) => ({ kind: "card" as const, id }))];
}

export function insertUnderstandingCard(route: UnderstandingRoute, cardId: string, before?: string): UnderstandingRoute {
  if (!route.some((entry) => entry.kind === "card" && entry.id === cardId)) throw new Error("Unknown understanding card");
  if (before === cardId) return route;
  const next = route.filter((entry) => entry.kind !== "card" || entry.id !== cardId);
  const index = before === undefined ? next.length : next.findIndex((entry) => entry.id === before);
  if (index < 0) throw new Error("Route position no longer exists");
  next.splice(index, 0, { kind: "card", id: cardId });
  return next;
}

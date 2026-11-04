import type { CanvasCard, CanvasEdge, ContextEpisode, ConversationGraph, ConversationMessage, EvidenceRef, MessageAnchor } from "../shared/types";

const readable = (card: CanvasCard) => card.kind !== "conversation" && card.kind !== "portal";

/** A single default route follows knowledge relations; saved user order still wins. */
export function recommendedReadingPath(cards: CanvasCard[], edges: CanvasEdge[]): CanvasCard[] {
  const available = cards.filter(readable);
  const byId = new Map(available.map((card) => [card.id, card]));
  const validEdges = edges.filter((edge) => edge.relation !== "attachment" && byId.has(edge.source) && byId.has(edge.target) && edge.source !== edge.target);
  const incoming = new Map(available.map((card) => [card.id, 0]));
  const outgoing = new Map<string, CanvasEdge[]>();
  for (const edge of validEdges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    const group = outgoing.get(edge.source) ?? [];
    group.push(edge); outgoing.set(edge.source, group);
  }
  const priority = (edge: CanvasEdge) => edge.knowledgeRelationType === "prerequisite" ? 0 : edge.knowledgeRelationType === "leads_to" ? 1 : edge.relation === "bridge" ? 2 : 3;
  const byPosition = (a: CanvasCard, b: CanvasCard) => a.x - b.x || a.y - b.y || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
  for (const group of outgoing.values()) group.sort((a, b) => priority(a) - priority(b) || byPosition(byId.get(a.target)!, byId.get(b.target)!));
  const roots = available.filter((card) => !incoming.get(card.id)).sort(byPosition);
  const result: CanvasCard[] = [];
  const seen = new Set<string>();
  const visit = (card: CanvasCard) => {
    const pending = [card];
    while (pending.length) {
      const current = pending.pop()!;
      if (seen.has(current.id)) continue;
      seen.add(current.id); result.push(current);
      const group = outgoing.get(current.id) ?? [];
      for (let index = group.length - 1; index >= 0; index--) pending.push(byId.get(group[index].target)!);
    }
  };
  for (const card of roots) visit(card);
  for (const card of [...available].sort(byPosition)) visit(card);
  return result;
}

export function readerNeighbors(cardId: string, cards: CanvasCard[], edges: CanvasEdge[], readingPathCardIds?: string[]): { previous: CanvasCard[]; next: CanvasCard[] } {
  const byId = new Map(cards.filter(readable).map((card) => [card.id, card]));
  if (readingPathCardIds?.length) {
    const savedIds = new Set(readingPathCardIds);
    const availablePath = [...readingPathCardIds.filter((id) => byId.has(id)), ...recommendedReadingPath(cards, edges).map((card) => card.id).filter((id) => !savedIds.has(id))];
    const position = availablePath.indexOf(cardId);
    if (position < 0) return { previous: [], next: [] };
    const previous = byId.get(availablePath[position - 1]);
    const next = byId.get(availablePath[position + 1]);
    return { previous: previous ? [previous] : [], next: next ? [next] : [] };
  }
  const route = recommendedReadingPath(cards, edges);
  const position = route.findIndex((card) => card.id === cardId);
  return { previous: position > 0 ? [route[position - 1]] : [], next: position >= 0 && position < route.length - 1 ? [route[position + 1]] : [] };
}

export function relatedKnowledge(cardId: string, cards: CanvasCard[], edges: CanvasEdge[], mainIds: string[]): Array<{ card: CanvasCard; label?: string }> {
  const byId = new Map(cards.filter(readable).map((card) => [card.id, card]));
  const excluded = new Set(mainIds);
  return edges.filter((edge) => edge.relation !== "attachment" && (edge.source === cardId || edge.target === cardId))
    .flatMap((edge) => { const card = byId.get(edge.source === cardId ? edge.target : edge.source); return card && !excluded.has(card.id) ? [{ card, label: edge.label }] : []; })
    .filter((item, index, all) => all.findIndex((candidate) => candidate.card.id === item.card.id) === index);
}

export function relevantMessages(messages: ConversationMessage[], refs: EvidenceRef[], anchors: MessageAnchor[]): ConversationMessage[] {
  const positions = messages.flatMap((message, index) => refs.some((ref) => Boolean(ref.messageId && (ref.messageId === message.id || ref.messageId === message.platformMessageId) || ref.questionId && (ref.questionId === message.id || ref.questionId === message.platformMessageId)))
    || anchors.some((anchor) => anchor.conversationId === message.conversationId && (Boolean(anchor.messageId && (anchor.messageId === message.id || anchor.messageId === message.platformMessageId)) || anchor.messageIndex === message.messageIndex && anchor.role === message.role)) ? [index] : []);
  if (!positions.length) return messages;
  const userPositions = messages.flatMap((message, index) => message.role === "user" ? [index] : []);
  const first = positions[0];
  const last = positions.at(-1)!;
  const firstTurn = userPositions.filter((index) => index <= first).length - 1;
  const lastTurn = userPositions.filter((index) => index <= last).length - 1;
  const start = userPositions[Math.max(0, firstTurn - 2)] ?? 0;
  const end = userPositions[lastTurn + 2] ?? messages.length;
  return messages.slice(start, end);
}

/** Prefer an analyzed contextual episode; older conversations retain the nearby-turn fallback. */
export function episodeMessages(messages: ConversationMessage[], refs: EvidenceRef[], anchors: MessageAnchor[], graph?: ConversationGraph | null): ConversationMessage[] {
  const episodes = matchingEpisodes(refs, graph);
  const included = new Set(episodes.flatMap((episode) => episode.messageIds));
  const matched = messages.filter((message) => included.has(message.id));
  const citedIds = new Set(refs.flatMap((ref) => [ref.messageId, ref.questionId].filter((id): id is string => Boolean(id))));
  const includesCitations = (subset: ConversationMessage[]) => messages.filter((message) => citedIds.has(message.id) || Boolean(message.platformMessageId && citedIds.has(message.platformMessageId))).every((message) => subset.includes(message));
  if (matched.length && includesCitations(matched)) return matched;
  const ids = new Set(refs.flatMap((ref) => [ref.questionId, ref.messageId].filter((id): id is string => Boolean(id))));
  const chapter = graph?.chapters?.find((item) => item.questionIds.some((id) => ids.has(id.replace(/^conversation-message-/u, ""))));
  if (chapter) {
    const firstId = chapter.questionIds[0]?.replace(/^conversation-message-/u, "");
    const first = messages.findIndex((message) => message.id === firstId);
    const next = graph?.chapters?.find((item) => item.order === chapter.order + 1)?.questionIds[0]?.replace(/^conversation-message-/u, "");
    const end = next ? messages.findIndex((message) => message.id === next) : messages.length;
    if (first >= 0) { const chapterMessages = messages.slice(first, end < 0 ? messages.length : end); if (includesCitations(chapterMessages)) return chapterMessages; }
  }
  return relevantMessages(messages, refs, anchors);
}

export function matchingEpisodes(refs: EvidenceRef[], graph?: ConversationGraph | null): ContextEpisode[] {
  const ids = new Set(refs.flatMap((ref) => [ref.messageId, ref.questionId].filter((id): id is string => Boolean(id))));
  const episodeIds = new Set(refs.flatMap((ref) => ref.episodeId ? [ref.episodeId] : []));
  return graph?.episodes?.filter((episode) => episodeIds.has(episode.id) || episode.questionIds.some((id) => ids.has(id)) || episode.messageIds.some((id) => ids.has(id))) ?? [];
}

import type { CanvasCard, CanvasEdge, Conversation } from "../shared/types";

export function topicConversationConnection(cards: CanvasCard[], sourceId: string, targetId: string): { topicId: string; conversationId: string } | null {
  const source = cards.find((card) => card.id === sourceId);
  const target = cards.find((card) => card.id === targetId);
  const topic = source?.kind === "topic" || source?.kind === "concept" ? source : target?.kind === "topic" || target?.kind === "concept" ? target : null;
  const conversation = source?.kind === "conversation" ? source : target?.kind === "conversation" ? target : null;
  return topic && conversation?.conversationIds[0] ? { topicId: topic.id, conversationId: conversation.conversationIds[0] } : null;
}

export function attachConversationToTopic(
  current: { cards: CanvasCard[]; edges: CanvasEdge[] },
  canvasId: string,
  topicId: string,
  conversation: Conversation,
  id: string,
  edgeId: string,
  now: number,
): { cards: CanvasCard[]; edges: CanvasEdge[] } {
  const topic = current.cards.find((card) => card.id === topicId && (card.kind === "topic" || card.kind === "concept"));
  if (!topic) return current;
  const existing = current.cards.find((card) => card.kind === "conversation" && card.conversationIds.includes(conversation.id));
  const cardId = existing?.id ?? id;
  const attachmentCount = current.edges.filter((edge) => edge.source === topicId && edge.relation === "attachment" && edge.target !== cardId).length;
  const x = topic.x + 282;
  let y = topic.y + attachmentCount * 100;
  const occupied = current.cards.filter((item) => item.id !== cardId && item.id !== topicId);
  for (let step = 0; step < 30; step += 1) {
    const overlap = occupied.some((item) => {
      const width = item.kind === "conversation" ? 200 : item.kind === "bridge" ? 170 : 252;
      const height = item.kind === "conversation" ? 108 : item.kind === "bridge" ? 70 : 160;
      return x < item.x + width + 16 && x + 200 + 16 > item.x && y < item.y + height + 16 && y + 108 + 16 > item.y;
    });
    if (!overlap) break;
    y += 112;
  }
  const card: CanvasCard = existing ? existing : {
    id: cardId, canvasId, kind: "conversation", title: conversation.title, description: conversation.summary,
    x, y, tags: [], anchorIds: [], conversationIds: [conversation.id], createdAt: now, updatedAt: now,
  };
  return {
    cards: [...current.cards.filter((item) => item.id !== cardId).map((item) => item.id === topicId
      ? { ...item, conversationIds: [...new Set([...item.conversationIds, conversation.id])] }
      : item), card],
    edges: [...current.edges.filter((edge) => !(edge.source === topicId && edge.target === cardId)), { id: edgeId, canvasId, source: topicId, target: cardId, type: "manual", relation: "attachment", createdAt: now }],
  };
}

export function createTopicFromConversation(
  current: { cards: CanvasCard[]; edges: CanvasEdge[] },
  canvasId: string,
  conversation: Conversation,
  position: { x: number; y: number },
  ids: { topicId: string; sourceCardId: string; edgeId: string },
  now: number,
): { cards: CanvasCard[]; edges: CanvasEdge[] } {
  const topic: CanvasCard = {
    id: ids.topicId,
    canvasId,
    kind: "topic",
    title: conversation.title,
    description: conversation.summary,
    x: position.x,
    y: position.y,
    tags: [],
    anchorIds: [],
    conversationIds: [],
    createdAt: now,
    updatedAt: now,
  };
  return attachConversationToTopic(
    { cards: [...current.cards, topic], edges: current.edges },
    canvasId,
    topic.id,
    conversation,
    ids.sourceCardId,
    ids.edgeId,
    now,
  );
}

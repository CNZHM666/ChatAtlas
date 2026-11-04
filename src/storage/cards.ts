import type { CanvasCard, CanvasMembership, KnowledgeCard, SourceRelation } from "../shared/types";
import { getDatabase } from "./db";
import { ensureKnowledgeMigration } from "./knowledge-graph";

const membershipId = (canvasId: string, cardId: string) => `${canvasId}:${cardId}`;
const portalId = (relationId: string, cardId: string) => `portal:${relationId}:${cardId}`;

function toCanvasCard(card: KnowledgeCard, membership: CanvasMembership, sources: SourceRelation[]): CanvasCard {
  return {
    id: card.id, canvasId: membership.canvasId, kind: card.type, title: card.title, description: card.body,
    notes: card.notes, x: membership.x, y: membership.y, tags: card.tags, evidenceRefs: card.evidenceRefs,
    anchorIds: sources.filter((source) => source.cardId === card.id && source.sourceType === "message").map((source) => source.sourceId),
    conversationIds: [...new Set(sources.filter((source) => source.cardId === card.id).map((source) => source.conversationId))],
    createdAt: card.createdAt, updatedAt: Math.max(card.updatedAt, membership.updatedAt), layoutLocked: membership.userPositioned,
    origin: card.origin, userEdited: card.userEdited, homeCanvasId: card.homeCanvasId,
  };
}

export async function listCards(canvasId: string): Promise<CanvasCard[]> {
  await ensureKnowledgeMigration();
  const db = await getDatabase();
  const memberships = await db.getAllFromIndex("canvasMemberships", "by-canvas", canvasId);
  const [cards, sources, relations, allMemberships] = await Promise.all([
    db.getAll("knowledgeCards"), db.getAll("sourceRelations"), db.getAll("knowledgeRelations"), db.getAll("canvasMemberships"),
  ]);
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const visible = new Set(memberships.map((item) => item.cardId));
  const result = memberships.flatMap((membership) => {
    const card = cardById.get(membership.cardId);
    return card ? [toCanvasCard(card, membership, sources)] : [];
  });
  let portalIndex = 0;
  for (const relation of relations.filter((item) => item.status === "accepted" && item.evidenceRefs.length)) {
    const localId = visible.has(relation.fromCardId) ? relation.fromCardId : visible.has(relation.toCardId) ? relation.toCardId : undefined;
    if (!localId) continue;
    const externalId = localId === relation.fromCardId ? relation.toCardId : relation.fromCardId;
    if (visible.has(externalId)) continue;
    const external = cardById.get(externalId);
    const destination = external?.homeCanvasId ?? allMemberships.find((item) => item.cardId === externalId)?.canvasId;
    if (!external || !destination) continue;
    const local = result.find((card) => card.id === localId);
    result.push({
      id: portalId(relation.id, externalId), canvasId, kind: "portal", title: external.title,
      description: relation.label ?? "跨画布概念", x: (local?.x ?? 0) + 330, y: (local?.y ?? 0) + portalIndex * 118,
      tags: [], anchorIds: [], conversationIds: [], createdAt: relation.createdAt, updatedAt: relation.updatedAt,
      origin: external.origin, homeCanvasId: external.homeCanvasId, portalCanvasId: destination, portalTargetCardId: external.id,
    });
    portalIndex += 1;
  }
  return result;
}

export async function countAllCards(): Promise<number> {
  await ensureKnowledgeMigration();
  return (await getDatabase()).count("knowledgeCards");
}

export async function saveCards(canvasId: string, cards: CanvasCard[]): Promise<void> {
  await ensureKnowledgeMigration();
  const db = await getDatabase();
  const persistedCards = cards.filter((card) => card.kind !== "portal");
  const existingMemberships = await db.getAllFromIndex("canvasMemberships", "by-canvas", canvasId);
  const keep = new Set(persistedCards.map((card) => card.id));
  const tx = db.transaction(["knowledgeCards", "canvasMemberships", "sourceRelations"], "readwrite");
  for (const membership of existingMemberships.filter((item) => !keep.has(item.cardId))) await tx.objectStore("canvasMemberships").delete(membership.id);
  for (const card of persistedCards) {
    const existingCard = await tx.objectStore("knowledgeCards").get(card.id);
    const contentChanged = Boolean(existingCard && (existingCard.title !== card.title || existingCard.body !== card.description || existingCard.notes !== card.notes));
    const id = membershipId(canvasId, card.id);
    const existingMembership = existingMemberships.find((item) => item.id === id);
    const positionChanged = Boolean(existingMembership && (existingMembership.x !== card.x || existingMembership.y !== card.y));
    const userChanged = contentChanged || positionChanged || Boolean(card.userEdited);
    const knowledgeCard: KnowledgeCard = {
      id: card.id, homeCanvasId: existingCard?.homeCanvasId ?? card.homeCanvasId ?? canvasId,
      type: card.kind === "topic" || card.kind === "bridge" || card.kind === "insight" || card.kind === "draft" || card.kind === "note" ? card.kind : "concept",
      title: card.title, body: card.description, notes: card.notes, evidenceRefs: existingCard?.evidenceRefs, tags: card.tags,
      origin: userChanged && (existingCard?.origin === "ai" || card.origin === "ai") ? "user_modified" : existingCard?.origin ?? card.origin ?? "user",
      userEdited: userChanged || existingCard?.userEdited || false,
      createdAt: existingCard?.createdAt ?? card.createdAt, updatedAt: card.updatedAt,
    };
    await tx.objectStore("knowledgeCards").put(knowledgeCard);
    await tx.objectStore("canvasMemberships").put({
      id, canvasId, cardId: card.id, x: card.x, y: card.y,
      userPositioned: Boolean(existingMembership?.userPositioned || card.layoutLocked || positionChanged),
      createdAt: existingMembership?.createdAt ?? card.createdAt, updatedAt: card.updatedAt,
    });
    const storedSources = await tx.objectStore("sourceRelations").index("by-card").getAll(card.id);
    const wantedConversationIds = new Set(card.conversationIds.filter((id) => !id.startsWith(`${card.id}-conversation-`)));
    for (const source of storedSources.filter((item) => item.sourceType === "conversation" && !wantedConversationIds.has(item.conversationId))) await tx.objectStore("sourceRelations").delete(source.id);
    for (const conversationId of wantedConversationIds) {
      const id = `${card.id}:conversation:${conversationId}`;
      await tx.objectStore("sourceRelations").put({ id, cardId: card.id, sourceType: "conversation", sourceId: conversationId, conversationId, createdAt: card.createdAt });
    }
  }
  await tx.done;
}

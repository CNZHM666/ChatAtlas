import type { CanvasMembership, KnowledgeCard, KnowledgeRelation } from "../shared/types";
import { stableId } from "./canvas-planner";
import { COMPOSITION_BUDGET, usefulCompositionText } from "./composition-guard";

export function synthesizeBridges(relations: KnowledgeRelation[], cards: KnowledgeCard[], memberships: CanvasMembership[], now = Date.now(), existingCards: KnowledgeCard[] = []): { cards: KnowledgeCard[]; memberships: CanvasMembership[]; relations: KnowledgeRelation[] } {
  const bridgeCards: KnowledgeCard[] = [];
  const bridgeMemberships: CanvasMembership[] = [];
  const rewritten: KnowledgeRelation[] = [];
  const maxBridges = Math.min(COMPOSITION_BUDGET.knowledge.bridges, Math.max(1, Math.floor(relations.length / 3)));
  const canvasCounts = new Map<string, number>();
  const occupied = new Map<string, Array<{ x: number; y: number }>>();
  for (const membership of memberships) occupied.set(membership.canvasId, [...occupied.get(membership.canvasId) ?? [], { x: membership.x, y: membership.y }]);
  for (const card of existingCards.filter((item) => item.type === "bridge")) for (const membership of memberships.filter((item) => item.cardId === card.id)) canvasCounts.set(membership.canvasId, (canvasCounts.get(membership.canvasId) ?? 0) + 1);
  for (const relation of relations) {
    const endpoints = cards.filter((card) => card.id === relation.fromCardId || card.id === relation.toCardId).map((card) => card.title);
    const targetCanvases = [...new Set(memberships.filter((item) => item.cardId === relation.fromCardId || item.cardId === relation.toCardId).map((item) => item.canvasId))];
    if (!relation.requiresExplanation || !usefulCompositionText(relation.label, endpoints, 5) || !relation.evidenceRefs.length || relation.status === "proposed_low_confidence" || bridgeCards.length >= maxBridges || targetCanvases.some((id) => (canvasCounts.get(id) ?? 0) >= COMPOSITION_BUDGET.knowledge.bridges)) { rewritten.push(relation); continue; }
    const bridgeId = stableId("bridge-ai", `${relation.fromCardId}:${relation.toCardId}:${relation.label}`);
    const from = cards.find((card) => card.id === relation.fromCardId);
    const to = cards.find((card) => card.id === relation.toCardId);
    bridgeCards.push({ id: bridgeId, type: "bridge", title: `${from?.title ?? ""} → ${to?.title ?? ""}`, body: relation.label!, evidenceRefs: relation.evidenceRefs, tags: [], origin: "ai", userEdited: false, createdAt: now, updatedAt: now });
    for (const id of targetCanvases) canvasCounts.set(id, (canvasCounts.get(id) ?? 0) + 1);
    for (const canvasId of targetCanvases) {
      const endpointsInCanvas = memberships.filter((item) => item.canvasId === canvasId && (item.cardId === relation.fromCardId || item.cardId === relation.toCardId));
      const preferredY = endpointsInCanvas.length ? Math.round(endpointsInCanvas.reduce((sum, item) => sum + item.y, 0) / endpointsInCanvas.length) : 120;
      const used = occupied.get(canvasId) ?? [];
      const x = 410;
      let y = Math.max(80, preferredY);
      while (used.some((item) => Math.abs(item.x - x) < 240 && Math.abs(item.y - y) < 120)) y += 140;
      used.push({ x, y });
      occupied.set(canvasId, used);
      bridgeMemberships.push({ id: `${canvasId}:${bridgeId}`, canvasId, cardId: bridgeId, x, y, userPositioned: false, createdAt: now, updatedAt: now });
    }
    rewritten.push(
      { ...relation, id: `${relation.id}:a`, toCardId: bridgeId, type: "explains", label: undefined },
      { ...relation, id: `${relation.id}:b`, fromCardId: bridgeId, type: "leads_to", label: undefined },
    );
  }
  return { cards: [...cards, ...bridgeCards], memberships: [...memberships, ...bridgeMemberships], relations: rewritten };
}

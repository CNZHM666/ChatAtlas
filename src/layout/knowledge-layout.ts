import type { CanvasMembership, KnowledgeCard } from "../shared/types";

function dimensions(card: KnowledgeCard | undefined): { width: number; height: number } {
  if (card?.type === "bridge") return { width: 190, height: 64 };
  if (card?.type === "insight" || card?.type === "draft") return { width: 224, height: 110 };
  return { width: 232, height: 120 };
}

/** Keep authored positions and move only newly proposed cards away from occupied rectangles. */
export function placeNewMemberships(proposed: CanvasMembership[], existing: CanvasMembership[], cards: KnowledgeCard[]): CanvasMembership[] {
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const placed = [...existing];
  return proposed.map((membership) => {
    if (membership.userPositioned || existing.some((item) => item.id === membership.id)) return membership;
    const size = dimensions(cardById.get(membership.cardId));
    let y = membership.y;
    const overlaps = () => placed.some((item) => {
      if (item.canvasId !== membership.canvasId || item.id === membership.id) return false;
      const other = dimensions(cardById.get(item.cardId));
      return membership.x < item.x + other.width + 24 && membership.x + size.width + 24 > item.x
        && y < item.y + other.height + 24 && y + size.height + 24 > item.y;
    });
    for (let attempt = 0; attempt < 200 && overlaps(); attempt += 1) y += 36;
    const next = { ...membership, y };
    placed.push(next);
    return next;
  });
}

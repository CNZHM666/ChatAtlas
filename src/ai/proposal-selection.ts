import type { KnowledgeProposal } from "../shared/types";

/** A selected canvas is applied with its cards, sources, and only resolvable relations. */
export function selectKnowledgeProposal(proposal: KnowledgeProposal, canvasIds: ReadonlySet<string>): KnowledgeProposal {
  const memberships = proposal.memberships.filter((membership) => canvasIds.has(membership.canvasId));
  const included = new Set(memberships.map((membership) => membership.cardId));
  const newlyProposed = new Set(proposal.cards.map((card) => card.id));
  const existsAfterApply = (id: string) => included.has(id) || !newlyProposed.has(id);
  return {
    ...proposal,
    canvases: proposal.canvases.filter((canvas) => canvasIds.has(canvas.id)),
    cards: proposal.cards.filter((card) => included.has(card.id)),
    memberships,
    relations: proposal.relations.filter((relation) => (included.has(relation.fromCardId) || included.has(relation.toCardId)) && existsAfterApply(relation.fromCardId) && existsAfterApply(relation.toCardId)),
    sources: proposal.sources.filter((source) => included.has(source.cardId)),
    evidenceUpdates: proposal.evidenceUpdates?.filter((update) => included.has(update.cardId)),
    scopeUpdates: proposal.scopeUpdates?.filter((update) => canvasIds.has(update.canvasId)),
  };
}

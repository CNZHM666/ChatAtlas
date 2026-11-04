import type { KnowledgeRelation } from "../shared/types";

export type DecisionDisposition = "propose" | "needs_review" | "discard";

export function relationDisposition(relation: KnowledgeRelation): DecisionDisposition {
  const evidenceEnough = relation.evidenceRefs.some((ref) => Boolean(ref.questionId || ref.messageId || ref.excerpt));
  if (!evidenceEnough || relation.confidenceBand === "low" || relation.proposedLowConfidence) return "discard";
  if (relation.confidenceBand === "medium") return "needs_review";
  return "propose";
}

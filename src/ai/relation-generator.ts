import type { ConversationSemanticProfile, EvidenceRef, KnowledgeCard, KnowledgeRelation, KnowledgeRelationType } from "../shared/types";
import { stableId } from "./canvas-planner";
import { canonicalConceptTitle, conceptKey } from "./concept-canonicalizer";

const explicitRelations: Array<{ from: string; to: string; type: KnowledgeRelationType; label: string; requiresExplanation: boolean }> = [
  { from: "np.roots", to: "系统极点", type: "used_for", label: "用于求解特征多项式的根", requiresExplanation: true },
  { from: "矩阵特征值", to: "系统极点", type: "explains", label: "状态矩阵的特征值对应系统极点", requiresExplanation: true },
  { from: "系统极点", to: "稳定性", type: "used_for", label: "极点位置用于判断系统稳定性", requiresExplanation: false },
  { from: "状态空间", to: "LQR", type: "prerequisite", label: "LQR 建立在状态空间模型上", requiresExplanation: false },
];

function evidenceFor(title: string, profiles: ConversationSemanticProfile[]): EvidenceRef[] {
  const key = conceptKey(canonicalConceptTitle(title));
  return profiles.filter((profile) => profile.concepts.some((concept) => conceptKey(canonicalConceptTitle(concept)) === key)).flatMap((profile) => profile.evidenceRefs).slice(0, 4);
}

function uniqueEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  return [...new Map(refs.map((ref) => [`${ref.conversationId}:${ref.questionId ?? ""}:${ref.messageId ?? ""}`, ref])).values()];
}

/** Sparse O(n × k) candidate retrieval; temporal adjacency alone never creates a relation. */
export function generateRelations(cards: KnowledgeCard[], profiles: ConversationSemanticProfile[], now = Date.now(), perCard = 4): KnowledgeRelation[] {
  const byKey = new Map(cards.map((card) => [conceptKey(canonicalConceptTitle(card.title)), card]));
  const relations = new Map<string, KnowledgeRelation>();
  const push = (from: KnowledgeCard, to: KnowledgeCard, type: KnowledgeRelationType, refs: EvidenceRef[], label?: string, requiresExplanation = false) => {
    if (from.id === to.id) return;
    const key = [from.id, to.id].sort().join("|");
    if (relations.has(key)) return;
    const evidenceRefs = uniqueEvidence(refs);
    relations.set(key, {
      id: stableId("relation-ai", `${from.id}:${to.id}:${type}`), fromCardId: from.id, toCardId: to.id,
      type, label, requiresExplanation, origin: "ai", status: evidenceRefs.length ? "proposed" : "proposed_low_confidence",
      proposedLowConfidence: !evidenceRefs.length, confidenceBand: evidenceRefs.length > 1 ? "high" : "medium",
      evidenceRefs, createdAt: now, updatedAt: now,
    });
  };
  for (const rule of explicitRelations) {
    const from = byKey.get(conceptKey(rule.from)); const to = byKey.get(conceptKey(rule.to));
    if (from && to) {
      const fromEvidence = evidenceFor(rule.from, profiles);
      const toEvidence = evidenceFor(rule.to, profiles);
      push(from, to, rule.type, fromEvidence.length && toEvidence.length ? [...fromEvidence, ...toEvidence] : [], rule.label, rule.requiresExplanation);
    }
  }
  const cooccurrence = new Map<string, number>();
  for (const profile of profiles) {
    const ids = [...new Set(profile.concepts.map((name) => byKey.get(conceptKey(canonicalConceptTitle(name)))?.id).filter((id): id is string => Boolean(id)))].slice(0, 12);
    for (let left = 0; left < ids.length; left++) for (let right = left + 1; right < ids.length; right++) {
      const key = [ids[left], ids[right]].sort().join("|");
      cooccurrence.set(key, (cooccurrence.get(key) ?? 0) + 1);
    }
  }
  const neighbors = new Map<string, Array<{ id: string; count: number }>>();
  for (const [key, count] of cooccurrence) {
    const [a, b] = key.split("|");
    neighbors.set(a, [...neighbors.get(a) ?? [], { id: b, count }]);
    neighbors.set(b, [...neighbors.get(b) ?? [], { id: a, count }]);
  }
  const byId = new Map(cards.map((card) => [card.id, card]));
  for (const [id, candidates] of neighbors) {
    for (const candidate of candidates.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)).slice(0, perCard)) {
      const from = byId.get(id); const to = byId.get(candidate.id);
      if (!from || !to) continue;
      const sourceConversations = profiles.filter((profile) => profile.concepts.some((concept) => conceptKey(canonicalConceptTitle(concept)) === conceptKey(from.title)) && profile.concepts.some((concept) => conceptKey(canonicalConceptTitle(concept)) === conceptKey(to.title)));
      push(from, to, "related_to", sourceConversations.flatMap((profile) => profile.evidenceRefs).slice(0, 4));
    }
  }
  return [...relations.values()].slice(0, Math.max(12, cards.length * perCard));
}

import { requestBudget } from "./request-policy";
import type { SourceExcerpt } from "./source-evidence";
import type { KnowledgeCard, KnowledgeRelation, QuestionSnapshot } from "../shared/types";
import type { AtlasAIProvider } from "./provider";
import { relationDisposition } from "./decision-policy";
import { canonicalConceptTitle, conceptKey } from "./concept-canonicalizer";

export interface RelationDecision {
  related: boolean;
  relationType: KnowledgeRelation["type"] | "none";
  direction: "forward" | "reverse" | "bidirectional";
  importance: "strong" | "medium" | "weak";
  evidenceEnough: boolean;
  bridgeNeeded: boolean;
  confidenceBand: "high" | "medium" | "low";
  reason?: string;
}

const relationTypes = new Set<KnowledgeRelation["type"]>(["part_of", "prerequisite", "used_for", "leads_to", "contrasts_with", "explains"]);

const hasEvidence = (relation: KnowledgeRelation) => relation.evidenceRefs.some((ref) => ref.conversationId && ref.conversationId !== "user-created" && (ref.questionId || ref.messageId || ref.excerpt));

/** Replace conversation-level sample references with questions that mention each endpoint. */
export function selectRelationEvidence(relation: KnowledgeRelation, cards: KnowledgeCard[], snapshots: QuestionSnapshot[]): KnowledgeRelation | null {
  const from = cards.find((card) => card.id === relation.fromCardId);
  const to = cards.find((card) => card.id === relation.toCardId);
  if (!from || !to) return null;
  const allowedConversations = new Set(relation.evidenceRefs.map((ref) => ref.conversationId));
  const relevant = snapshots.filter((snapshot) => allowedConversations.has(snapshot.conversationId));
  const matches = (snapshot: QuestionSnapshot, title: string) => {
    const key = conceptKey(canonicalConceptTitle(title));
    return snapshot.concepts.some((concept) => conceptKey(canonicalConceptTitle(concept)) === key)
      || key.length >= 3 && conceptKey(`${snapshot.summary} ${snapshot.answerKeypoint ?? ""}`).includes(key);
  };
  const fromEvidence = relevant.filter((snapshot) => matches(snapshot, from.title)).slice(0, 2);
  const toEvidence = relevant.filter((snapshot) => matches(snapshot, to.title)).slice(0, 2);
  if (!fromEvidence.length || !toEvidence.length) return null;
  const refs = [...new Map([fromEvidence[0], toEvidence[0], ...fromEvidence.slice(1), ...toEvidence.slice(1)].map((snapshot) => [snapshot.questionId, { conversationId: snapshot.conversationId, questionId: snapshot.questionId, messageId: snapshot.questionId }])).values()];
  return { ...relation, evidenceRefs: refs };
}

export function verifyRelations(relations: KnowledgeRelation[], rejectedIds: Set<string>): KnowledgeRelation[] {
  return relations.filter((relation) => !rejectedIds.has(relation.id) && hasEvidence(relation))
    .map((relation) => ({ ...relation, status: relation.status === "proposed_low_confidence" ? "proposed_low_confidence" as const : "proposed" as const, evidenceRefs: [...new Map(relation.evidenceRefs.map((ref) => [`${ref.conversationId}:${ref.questionId ?? ""}:${ref.messageId ?? ""}`, ref])).values()] }))
    .filter((relation) => relationDisposition(relation) !== "discard");
}

/** Verify only retrieved candidates against compact snapshots; no full transcript is sent. */
export async function verifyRelationCandidates(input: {
  relations: KnowledgeRelation[];
  cards: KnowledgeCard[];
  snapshots: QuestionSnapshot[];
  loadEvidence?: (conversationId: string, questionId: string | undefined, query: string) => Promise<SourceExcerpt[]>;
  provider?: AtlasAIProvider;
  requireAI?: boolean;
  rejectedIds: Set<string>;
  onRequest?: (inputCharacters: number, outputCharacters: number, failed?: boolean) => void;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}): Promise<KnowledgeRelation[]> {
  const candidates = verifyRelations(input.relations, input.rejectedIds);
  if (!input.provider || !candidates.length) return candidates;
  const titles = new Map(input.cards.map((card) => [card.id, card.title]));
  const snapshots = new Map(input.snapshots.map((snapshot) => [snapshot.questionId, snapshot]));
  const verified: KnowledgeRelation[] = [];
  for (let index = 0; index < candidates.length;) {
    input.signal?.throwIfAborted();
    const batch = candidates.slice(index, index + 12);
    const originalEvidence = new Map<string, SourceExcerpt[]>();
    for (const relation of batch) for (const ref of relation.evidenceRefs.slice(0, 2)) {
      if (input.loadEvidence) originalEvidence.set(`${relation.id}:${ref.conversationId}:${ref.questionId ?? ref.messageId}`, (await input.loadEvidence(ref.conversationId, ref.questionId ?? ref.messageId, `${titles.get(relation.fromCardId)} ${titles.get(relation.toCardId)}`)).slice(0, 1).map((excerpt) => ({ ...excerpt, text: excerpt.text.slice(0, 350) })));
    }
    const buildPrompt = () => JSON.stringify({ candidates: batch.map((relation) => ({ id: relation.id, from: titles.get(relation.fromCardId), to: titles.get(relation.toCardId), relationType: relation.type, evidence: relation.evidenceRefs.slice(0, 2).map((ref) => { const snapshot = snapshots.get(ref.questionId ?? ref.messageId ?? ""); return { conversationId: ref.conversationId, questionId: ref.questionId ?? ref.messageId, summary: snapshot?.summary.slice(0, 160) ?? ref.excerpt, answer: snapshot?.answerKeypoint?.slice(0, 100), excerpts: originalEvidence.get(`${relation.id}:${ref.conversationId}:${ref.questionId ?? ref.messageId}`) }; }) })), schema: { decisions: [{ id: "candidate id", related: true, relationType: "prerequisite | used_for | explains | leads_to | contrasts_with | part_of | none", direction: "forward | reverse | bidirectional", importance: "strong | medium | weak", evidenceEnough: true, bridgeNeeded: false, reason: "short evidence-grounded reading transition when bridgeNeeded, otherwise brief reason", confidenceBand: "high | medium | low" }] } });
    let prompt = buildPrompt();
    while (batch.length > 1 && requestBudget({ taskType: "relation_judge", system: "", prompt }).inputTokens > 12500) { batch.pop(); prompt = buildPrompt(); }
    index += batch.length;
    try {
      const request = {
        taskType: "relation_judge" as const, conversationIds: [...new Set(batch.flatMap((relation) => relation.evidenceRefs.map((ref) => ref.conversationId)))],
        system: "Verify whether each candidate helps a person follow a knowledge reading path. Use only supplied evidence; reject co-occurrence, vague related_to, and merely sequential associations. Return strict JSON. Mark bridgeNeeded only for a real mental jump, and explain that jump in the reason as a reading transition grounded in both sources.",
        prompt,
        validate: (value: unknown) => {
          if (!value || typeof value !== "object" || !Array.isArray((value as { decisions?: unknown }).decisions)) throw new Error("Invalid relation decisions");
          return (value as { decisions: Array<Record<string, unknown>> }).decisions;
        },
      };
      const decisions = await (input.provider.decide?.(request) ?? input.provider.generateStructured(request));
      input.onRequest?.(prompt.length, JSON.stringify(decisions).length);
      for (const relation of batch) {
        const decision = decisions.find((item) => item.id === relation.id);
        if (!decision || decision.related !== true || decision.evidenceEnough !== true || typeof decision.relationType !== "string" || !relationTypes.has(decision.relationType as KnowledgeRelation["type"])) continue;
        const band = decision.confidenceBand === "high" || decision.confidenceBand === "medium" ? decision.confidenceBand : "low";
        if (band === "low") continue;
        const reverse = decision.direction === "reverse";
        verified.push({ ...relation, fromCardId: reverse ? relation.toCardId : relation.fromCardId, toCardId: reverse ? relation.fromCardId : relation.toCardId, type: decision.relationType as KnowledgeRelation["type"], label: typeof decision.reason === "string" ? decision.reason.slice(0, 180) : relation.label, confidenceBand: band, importance: decision.importance === "strong" || decision.importance === "weak" ? decision.importance : "medium", status: "proposed", proposedLowConfidence: false, requiresExplanation: decision.bridgeNeeded === true });
      }
    } catch { input.signal?.throwIfAborted(); input.onRequest?.(prompt.length, 0, true); }
    input.onProgress?.(index, candidates.length);
  }
  return verified;
}

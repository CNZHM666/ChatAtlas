import { describe, expect, it } from "vitest";
import type { KnowledgeCard, KnowledgeRelation, QuestionSnapshot } from "../shared/types";
import { canonicalizeConcepts } from "./concept-canonicalizer";
import { generateRelations } from "./relation-generator";
import { synthesizeBridges } from "./bridge-synthesizer";
import type { AtlasAIProvider, StructuredAIRequest } from "./provider";
import { selectRelationEvidence, verifyRelationCandidates, verifyRelations } from "./relation-verifier";

const knowledgeCard = (id: string, title: string): KnowledgeCard => ({
  id, type: "concept", title, tags: [], origin: "ai", userEdited: false, createdAt: 1, updatedAt: 1,
});

describe("knowledge pipeline", () => {
  it("canonicalizes aliases before generating relations", () => {
    const result = canonicalizeConcepts([
      knowledgeCard("pole-a", "极点"), knowledgeCard("pole-b", "System Poles"), knowledgeCard("roots", "np.roots"),
    ], []);
    expect(result.cards.filter((card) => card.title === "系统极点")).toHaveLength(1);
    expect(result.idMap.get("pole-b")).toBe(result.idMap.get("pole-a"));
  });

  it("creates an evidence-backed bridge from different conversations", () => {
    const cards = [knowledgeCard("roots", "np.roots"), knowledgeCard("poles", "系统极点")];
    const profiles = [
      { conversationId: "conversation-roots", summary: "", domains: ["编程与开源"], topics: [], concepts: ["np.roots"], intent: "", evidenceRefs: [{ conversationId: "conversation-roots", messageId: "m1" }], analyzedVersion: "1", updatedAt: 1 },
      { conversationId: "conversation-poles", summary: "", domains: ["控制与自动化"], topics: [], concepts: ["系统极点"], intent: "", evidenceRefs: [{ conversationId: "conversation-poles", messageId: "m2" }], analyzedVersion: "1", updatedAt: 1 },
    ];
    const relations = generateRelations(cards, profiles, 2);
    const bridged = synthesizeBridges(relations, cards, [
      { id: "programming:roots", canvasId: "programming", cardId: "roots", x: 0, y: 0, userPositioned: false, createdAt: 1, updatedAt: 1 },
      { id: "control:poles", canvasId: "control", cardId: "poles", x: 0, y: 0, userPositioned: false, createdAt: 1, updatedAt: 1 },
    ], 2);
    const verified = verifyRelations(bridged.relations, new Set());
    expect(bridged.cards.some((card) => card.type === "bridge" && /特征多项式/.test(card.body ?? ""))).toBe(true);
    expect(new Set(verified.flatMap((relation) => relation.evidenceRefs.map((ref) => ref.conversationId)))).toEqual(new Set(["conversation-roots", "conversation-poles"]));
  });

  it("keeps candidates sparse and never accepts a relation with missing source evidence", () => {
    const cards = [knowledgeCard("roots-sparse", "np.roots"), knowledgeCard("poles-sparse", "系统极点"), ...Array.from({ length: 10 }, (_, index) => knowledgeCard(`extra-${index}`, `Concept ${index}`))];
    const profiles = [{ conversationId: "evidence-only-roots", summary: "", domains: ["编程与开源"], topics: [], concepts: ["np.roots", ...cards.slice(2).map((card) => card.title)], intent: "", evidenceRefs: [{ conversationId: "evidence-only-roots", messageId: "q1" }], analyzedVersion: "1", updatedAt: 1 }];
    const candidates = generateRelations(cards, profiles, 2, 3);
    const unsupported = candidates.find((relation) => relation.fromCardId === "roots-sparse" && relation.toCardId === "poles-sparse");
    expect(unsupported).toMatchObject({ status: "proposed_low_confidence", evidenceRefs: [] });
    expect(verifyRelations(candidates, new Set())).not.toContainEqual(unsupported);
    expect(candidates.length).toBeLessThan(cards.length * 4);
  });

  it("uses endpoint-specific question evidence and drops unsupported relation candidates", () => {
    const cards = [knowledgeCard("alpha", "Alpha"), knowledgeCard("beta", "Beta")];
    const relation: KnowledgeRelation = { id: "scoped-evidence", fromCardId: "alpha", toCardId: "beta", type: "related_to", origin: "ai", status: "proposed", evidenceRefs: [{ conversationId: "source", questionId: "unrelated" }], createdAt: 1, updatedAt: 1 };
    const snapshot = (questionId: string, conversationId: string, concepts: string[]): QuestionSnapshot => ({ questionId, conversationId, displayTitle: questionId, summary: questionId, concepts, sourceHash: questionId, analysisVersion: 1, updatedAt: 1 });
    const snapshots = [snapshot("unrelated", "source", ["Gamma"]), snapshot("supports-alpha", "source", ["Alpha"]), snapshot("supports-beta", "source", ["Beta"]), snapshot("outside-source", "other", ["Alpha", "Beta"])];
    expect(selectRelationEvidence(relation, cards, snapshots)?.evidenceRefs.map((ref) => ref.questionId)).toEqual(["supports-alpha", "supports-beta"]);
    expect(selectRelationEvidence(relation, cards, snapshots.slice(0, 2))).toBeNull();
  });

  it("creates bridges only for marked, evidence-backed non-obvious relations", () => {
    const cards = [knowledgeCard("bridge-a", "np.roots"), knowledgeCard("bridge-b", "系统极点"), knowledgeCard("bridge-c", "Python")];
    const relation = { id: "bridge-worthy", fromCardId: "bridge-a", toCardId: "bridge-b", type: "used_for" as const, label: "用于求解特征多项式的根", requiresExplanation: true, origin: "ai" as const, status: "proposed" as const, evidenceRefs: [{ conversationId: "a", messageId: "q1" }, { conversationId: "b", messageId: "q2" }], createdAt: 1, updatedAt: 1 };
    const ordinary = { ...relation, id: "obvious", fromCardId: "bridge-c", toCardId: "bridge-a", label: "Related", requiresExplanation: false };
    const result = synthesizeBridges([relation, ordinary], cards, [], 2);
    expect(result.cards.filter((card) => card.type === "bridge")).toHaveLength(1);
    expect(result.relations.some((item) => item.id === "obvious")).toBe(true);
  });

  it("keeps processing later relation batches when one judge batch fails", async () => {
    const cards = Array.from({ length: 14 }, (_, index) => knowledgeCard(`partial-${index}`, `概念 ${index}`));
    const relations: KnowledgeRelation[] = Array.from({ length: 13 }, (_, index) => ({
      id: `partial-relation-${index}`, fromCardId: cards[index].id, toCardId: cards[index + 1].id,
      type: "used_for", label: "用于验证局部失败", origin: "ai", status: "proposed",
      evidenceRefs: [{ conversationId: "partial", questionId: `partial-q-${index}`, messageId: `partial-q-${index}` }], createdAt: 1, updatedAt: 1,
    }));
    const snapshots: QuestionSnapshot[] = relations.map((_, index) => ({
      questionId: `partial-q-${index}`, conversationId: "partial", sourceHash: `${index}`, analysisVersion: 1,
      normalizedQuestion: `问题 ${index}`, displayTitle: `问题 ${index}`, summary: `证据 ${index}`, intents: [], topics: [], concepts: [], createdAt: 1, updatedAt: 1,
    }));
    let calls = 0;
    const provider: AtlasAIProvider = {
      testConnection: async () => ({ ok: true as const, model: "test" }),
      generateStructured: async <T>(request: StructuredAIRequest<T>) => {
        calls += 1;
        if (calls === 1) throw new Error("transient judge failure");
        return request.validate({ decisions: [{ id: "partial-relation-12", related: true, relationType: "used_for", direction: "forward", importance: "medium", evidenceEnough: true, bridgeNeeded: false, confidenceBand: "high", reason: "有直接证据" }] });
      },
    };
    const verified = await verifyRelationCandidates({ relations, cards, snapshots, provider, rejectedIds: new Set(), requireAI: true });
    expect(calls).toBe(2);
    expect(verified.map((relation) => relation.id)).toEqual(["partial-relation-12"]);
  });
});

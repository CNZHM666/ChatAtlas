import { describe, expect, it } from "vitest";
import type { KnowledgeProposal } from "../shared/types";
import { selectKnowledgeProposal } from "./proposal-selection";

const canvas = (id: string) => ({ id, title: id, type: "topic" as const, origin: "ai" as const, userEdited: false, createdAt: 1, updatedAt: 1 });
const card = (id: string) => ({ id, type: "concept" as const, title: id, tags: [], origin: "ai" as const, userEdited: false, createdAt: 1, updatedAt: 1 });
const membership = (canvasId: string, cardId: string) => ({ id: `${canvasId}:${cardId}`, canvasId, cardId, x: 0, y: 0, userPositioned: false, createdAt: 1, updatedAt: 1 });

describe("proposal selection", () => {
  it("keeps selected domain content and drops dangling proposed relations", () => {
    const proposal: KnowledgeProposal = {
      id: "proposal", status: "preview", mode: "initial", canvases: [canvas("a"), canvas("b")], cards: [card("one"), card("two")],
      memberships: [membership("a", "one"), membership("b", "two")],
      relations: [
        { id: "cross", fromCardId: "one", toCardId: "two", type: "related_to", origin: "ai", status: "proposed", evidenceRefs: [], createdAt: 1, updatedAt: 1 },
        { id: "historical", fromCardId: "one", toCardId: "already-saved", type: "related_to", origin: "ai", status: "proposed", evidenceRefs: [], createdAt: 1, updatedAt: 1 },
      ],
      sources: [{ id: "source-one", cardId: "one", sourceType: "conversation", sourceId: "conversation", conversationId: "conversation", createdAt: 1 }, { id: "source-two", cardId: "two", sourceType: "conversation", sourceId: "conversation", conversationId: "conversation", createdAt: 1 }],
      analyzedConversationIds: [], reviewConversationIds: [], createdAt: 1, updatedAt: 1,
    };
    const selected = selectKnowledgeProposal(proposal, new Set(["a"]));
    expect(selected.canvases.map((item) => item.id)).toEqual(["a"]);
    expect(selected.cards.map((item) => item.id)).toEqual(["one"]);
    expect(selected.memberships.map((item) => item.cardId)).toEqual(["one"]);
    expect(selected.relations.map((item) => item.id)).toEqual(["historical"]);
    expect(selected.sources.map((item) => item.id)).toEqual(["source-one"]);
  });
});

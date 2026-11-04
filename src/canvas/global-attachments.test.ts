import { describe, expect, it } from "vitest";
import type { CanvasCard, Conversation } from "../shared/types";
import { attachConversationToTopic, createTopicFromConversation, topicConversationConnection } from "./global-attachments";

const canvasId = "test-canvas";
const topic = (id: string): CanvasCard => ({ id, canvasId, kind: "topic", title: id, x: 0, y: 0, tags: [], anchorIds: [], conversationIds: [], createdAt: 1, updatedAt: 1 });
const conversation: Conversation = { id: "source-1", platform: "chatgpt", title: "poles source", url: "https://chatgpt.com/c/source-1", updatedAt: 1, messageCount: 10 };

describe("conversation attachment", () => {
  it("creates a compact source card with an attachment relation without deleting library data", () => {
    const result = attachConversationToTopic({ cards: [topic("control")], edges: [] }, canvasId, "control", conversation, "source-card", "edge-1", 2);
    expect(result.cards[1]).toMatchObject({ kind: "conversation", conversationIds: ["source-1"], title: "poles source" });
    expect(result.edges[0]).toMatchObject({ source: "control", target: "source-card", relation: "attachment" });
    expect(result.cards[0].conversationIds).toContain(conversation.id);
  });

  it("lets one conversation source support multiple topics without moving the original card", () => {
    const first = attachConversationToTopic({ cards: [topic("control"), topic("numpy")], edges: [] }, canvasId, "control", conversation, "source-card", "edge-1", 2);
    const attached = attachConversationToTopic(first, canvasId, "numpy", conversation, "unused", "edge-2", 3);
    expect(attached.cards.filter((card) => card.kind === "conversation")).toHaveLength(1);
    expect(attached.edges.filter((edge) => edge.relation === "attachment")).toEqual([expect.objectContaining({ source: "control", target: "source-card" }), expect.objectContaining({ source: "numpy", target: "source-card" })]);
    expect(attached.cards.find((card) => card.id === "control")?.conversationIds).toEqual([conversation.id]);
    expect(attached.cards.find((card) => card.id === "numpy")?.conversationIds).toEqual([conversation.id]);
    expect(attached.cards.find((card) => card.id === "source-card")?.x).toBe(first.cards.find((card) => card.id === "source-card")?.x);
  });

  it("treats a handle connection in either direction as a real conversation attachment", () => {
    const source: CanvasCard = { ...topic("source-card"), kind: "conversation", conversationIds: [conversation.id] };
    expect(topicConversationConnection([topic("control"), source], "control", "source-card")).toEqual({ topicId: "control", conversationId: conversation.id });
    expect(topicConversationConnection([topic("control"), source], "source-card", "control")).toEqual({ topicId: "control", conversationId: conversation.id });
    expect(topicConversationConnection([topic("control"), topic("numpy")], "control", "numpy")).toBeNull();
  });

  it("attaches sources to an AI-generated concept card", () => {
    const concept: CanvasCard = { ...topic("concept"), kind: "concept" };
    const source: CanvasCard = { ...topic("source-card"), kind: "conversation", conversationIds: [conversation.id] };
    expect(topicConversationConnection([concept, source], "concept", "source-card")).toEqual({ topicId: "concept", conversationId: conversation.id });
    const result = attachConversationToTopic({ cards: [concept], edges: [] }, canvasId, concept.id, conversation, "source-card", "source-edge", 2);
    expect(result.edges[0]).toMatchObject({ source: concept.id, relation: "attachment" });
  });

  it("replaces an old structural line when converting a source to an attachment", () => {
    const source: CanvasCard = { ...topic("source-card"), kind: "conversation", conversationIds: [conversation.id] };
    const result = attachConversationToTopic({ cards: [topic("control"), source], edges: [{ id: "old", canvasId, source: "control", target: "source-card", type: "manual", relation: "structural", createdAt: 1 }] }, canvasId, "control", conversation, "unused", "new", 2);
    expect(result.edges).toEqual([expect.objectContaining({ id: "new", relation: "attachment" })]);
  });

  it("places a new source clear of neighboring cards", () => {
    const neighboring = { ...topic("neighbor"), x: 300, y: 0 };
    const result = attachConversationToTopic({ cards: [topic("control"), neighboring], edges: [] }, canvasId, "control", conversation, "source-card", "edge-1", 2);
    expect(result.cards.find((card) => card.id === "source-card")?.y).toBeGreaterThan(160);
  });

  it("creates a topic named after a conversation when it is dropped on blank canvas space", () => {
    const result = createTopicFromConversation({ cards: [], edges: [] }, canvasId, conversation, { x: 120, y: 80 }, { topicId: "topic-1", sourceCardId: "source-card", edgeId: "edge-1" }, 2);
    expect(result.cards.find((card) => card.id === "topic-1")).toMatchObject({ kind: "topic", title: conversation.title, x: 120, y: 80, conversationIds: [conversation.id] });
    expect(result.cards.find((card) => card.id === "source-card")).toMatchObject({ kind: "conversation", conversationIds: [conversation.id] });
    expect(result.edges).toEqual([expect.objectContaining({ source: "topic-1", target: "source-card", relation: "attachment" })]);
  });
});

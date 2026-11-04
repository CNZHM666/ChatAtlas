import { describe, expect, it } from "vitest";
import type { CanvasCard, CanvasEdge, ConversationMessage } from "../shared/types";
import { episodeMessages, readerNeighbors, relatedKnowledge, relevantMessages, recommendedReadingPath } from "./reader-path";

const card = (id: string, kind: CanvasCard["kind"] = "concept"): CanvasCard => ({
  id, canvasId: "space", kind, title: id, x: 0, y: 0, tags: [], anchorIds: [], conversationIds: [], createdAt: 1, updatedAt: 1,
});
const edge = (source: string, target: string, relation: CanvasEdge["relation"] = "structural"): CanvasEdge => ({
  id: `${source}-${target}`, canvasId: "space", source, target, relation, type: "manual", createdAt: 1,
});
const message = (index: number): ConversationMessage => ({
  id: `m-${index}`, conversationId: "conversation", messageIndex: index, role: index % 2 ? "assistant" : "user",
  content: `Content ${index}`, preview: `Content ${index}`, contentHash: `hash-${index}`, createdAt: 1, updatedAt: 1,
});

describe("knowledge review path", () => {
  it("handles a long dependency chain without recursive stack growth and preserves chronology", () => {
    const cards = Array.from({ length: 10000 }, (_, index) => ({ ...card(`chain-${index}`), x: index }));
    const edges = cards.slice(1).map((item, index) => edge(cards[index].id, item.id));
    expect(recommendedReadingPath(cards, edges).map((item) => item.id)).toEqual(cards.map((item) => item.id));
  });
  it("follows knowledge relations and excludes source attachments", () => {
    const cards = [card("before"), card("current"), card("bridge", "bridge"), card("after"), card("source", "conversation")];
    const path = readerNeighbors("current", cards, [edge("before", "current"), edge("current", "bridge", "bridge"), edge("current", "after"), edge("current", "source", "attachment")]);
    expect(path.previous.map((item) => item.id)).toEqual(["before"]);
    expect(path.next.map((item) => item.id)).toEqual(["bridge"]);
    expect(relatedKnowledge("current", cards, [edge("current", "bridge", "bridge"), edge("current", "after")], ["current", "bridge", "before"]).map((item) => item.card.id)).toEqual(["after"]);
  });

  it("uses a confirmed reading path instead of secondary graph relations", () => {
    const cards = [card("before"), card("current"), card("after"), card("related")];
    const path = readerNeighbors("current", cards, [edge("current", "related")], ["before", "current", "after"]);
    expect(path.previous.map((item) => item.id)).toEqual(["before"]);
    expect(path.next.map((item) => item.id)).toEqual(["after"]);
  });
  it("skips cards removed from a saved reading path", () => {
    const cards = [card("before"), card("current"), card("after")];
    const path = readerNeighbors("current", cards, [], ["before", "deleted", "current", "after"]);
    expect(path.previous.map((item) => item.id)).toEqual(["before"]);
    expect(path.next.map((item) => item.id)).toEqual(["after"]);
  });

  it("shows a grounded discussion window and keeps the full source available separately", () => {
    const messages = Array.from({ length: 20 }, (_, index) => message(index));
    expect(relevantMessages(messages, [{ conversationId: "conversation", messageId: "m-8" }], []).map((item) => item.id)).toEqual(messages.slice(4, 12).map((item) => item.id));
    expect(relevantMessages(messages, [], [{ id: "anchor", conversationId: "conversation", conversationUrl: "", messageIndex: 8, role: "user", preview: "", contentHash: "hash-8", createdAt: 1 }]).map((item) => item.id)).toEqual(messages.slice(4, 12).map((item) => item.id));
    expect(relevantMessages(messages, [], [])).toEqual(messages);
  });

  it("reads the complete analyzed episode when a question has evidence", () => {
    const messages = Array.from({ length: 20 }, (_, index) => message(index));
    const graph = { conversationId: "conversation", nodes: [], edges: [], updatedAt: 1, episodes: [{ id: "episode", chapterId: "chapter", conversationId: "conversation", title: "Follow-up", questionIds: ["m-8"], messageIds: ["m-8", "m-9", "m-10", "m-11"] }] };
    expect(episodeMessages(messages, [{ conversationId: "conversation", questionId: "m-8" }], [], graph).map((item) => item.id)).toEqual(["m-8", "m-9", "m-10", "m-11"]);
  });

  it("uses the evidence window when analyzed IDs are stale", () => {
    const messages = Array.from({ length: 20 }, (_, index) => message(index));
    const graph = { conversationId: "conversation", nodes: [], edges: [], updatedAt: 1, episodes: [{ id: "episode", chapterId: "chapter", conversationId: "conversation", title: "Follow-up", questionIds: ["m-8"], messageIds: ["stale-id"] }] };
    expect(episodeMessages(messages, [{ conversationId: "conversation", questionId: "m-8" }], [], graph)).toEqual(messages.slice(4, 12));
  });
});

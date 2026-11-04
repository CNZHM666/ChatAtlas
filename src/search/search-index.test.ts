import { describe, expect, it } from "vitest";
import { mockAnchors, mockCards, mockConversations } from "../test/mock-data";
import { searchAtlas } from "./search-index";

describe("searchAtlas", () => {
  it("finds cards and messages from a multi-token query", () => {
    const results = searchAtlas("astype complex", {
      cards: mockCards,
      conversations: mockConversations,
      anchors: mockAnchors,
    });
    expect(results.some((result) => result.kind === "anchor" && result.id === "anchor-astype")).toBe(true);
    expect(results.some((result) => result.kind === "card" && result.id === "complex")).toBe(true);
  });

  it("returns compact results for an empty query", () => {
    const results = searchAtlas("", { cards: mockCards, conversations: [], anchors: [] });
    expect(results).toHaveLength(mockCards.length);
  });

  it("finds text written in a topic note", () => {
    const results = searchAtlas("follow up tomorrow", { cards: [{ ...mockCards[0], notes: "Follow up tomorrow about retries" }], conversations: [], anchors: [] });
    expect(results[0]).toMatchObject({ kind: "card", id: mockCards[0].id });
  });
});

import { describe, expect, it } from "vitest";
import type { CanvasMembership, KnowledgeCard } from "../shared/types";
import { placeNewMemberships } from "./knowledge-layout";

const card = (id: string): KnowledgeCard => ({ id, type: "concept", title: id, tags: [], origin: "ai", userEdited: false, createdAt: 1, updatedAt: 1 });
const membership = (id: string, x: number, y: number, userPositioned = false): CanvasMembership => ({ id: `map:${id}`, canvasId: "map", cardId: id, x, y, userPositioned, createdAt: 1, updatedAt: 1 });

describe("knowledge proposal placement", () => {
  it("moves new cards away from existing cards without shifting authored positions", () => {
    const existing = membership("authored", 100, 100, true);
    const [proposed] = placeNewMemberships([membership("new", 100, 100)], [existing], [card("authored"), card("new")]);
    expect(proposed.x).toBe(100);
    expect(proposed.y).toBeGreaterThanOrEqual(244);
    expect(existing).toEqual(membership("authored", 100, 100, true));
  });
});

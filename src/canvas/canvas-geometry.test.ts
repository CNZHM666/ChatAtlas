import { describe, expect, it } from "vitest";
import type { CanvasCard, CanvasEdge } from "../shared/types";
import { alignConnectedBox, arrangeSubtree, insertionSpace, organizeCards, snapBox } from "./canvas-geometry";

const card = (id: string, x: number, y: number): CanvasCard => ({ id, canvasId: "test", kind: "topic", title: id, x, y, tags: [], anchorIds: [], conversationIds: [], createdAt: 1, updatedAt: 1 });
const edge = (source: string, target: string): CanvasEdge => ({ id: `${source}-${target}`, canvasId: "test", source, target, type: "manual", relation: "structural", createdAt: 1 });

describe("canvas geometry", () => {
  it("snaps nearby centers and returns a transient guide", () => {
    const result = snapBox({ id: "a", x: 300, y: 106, width: 232, height: 128 }, [{ id: "b", x: 0, y: 100, width: 232, height: 128 }]);
    expect(result.y).toBe(100);
    expect(result.guides).toContainEqual(expect.objectContaining({ axis: "y", coordinate: 100 }));
  });

  it("opens a centered insertion slot without moving unrelated cards", () => {
    const moving = { id: "moving", x: 350, y: 0, width: 232, height: 128 };
    const result = insertionSpace(moving, [
      { id: "left", x: 100, y: 0, width: 232, height: 128 },
      { id: "right", x: 600, y: 0, width: 232, height: 128 },
      { id: "far", x: 1400, y: 0, width: 232, height: 128 },
    ]);
    expect(result.map((item) => item.id)).toEqual(["left", "right"]);
    expect(result[0].x).toBeLessThan(100);
    expect(result[1].x).toBeGreaterThan(600);
  });

  it("does not push a neighbor into a third card", () => {
    const moving = { id: "moving", x: 350, y: 0, width: 232, height: 128 };
    expect(insertionSpace(moving, [
      { id: "left", x: 100, y: 0, width: 232, height: 128 },
      { id: "right", x: 600, y: 0, width: 232, height: 128 },
      { id: "blocked", x: 842, y: 0, width: 232, height: 128 },
    ])).toEqual([]);
  });

  it("straightens a connection only within a small, clear move", () => {
    const source = { id: "source", x: 0, y: 100, width: 232, height: 128 };
    const target = { id: "target", x: 360, y: 113, width: 232, height: 128 };
    expect(alignConnectedBox(source, target, [source, target])).toEqual({ x: 360, y: 100 });
    expect(alignConnectedBox(source, { ...target, y: 150 }, [source, target])).toBeNull();
  });

  it("distributes middle nodes while retaining both endpoints", () => {
    const cards = [card("a", 0, 0), card("b", 350, 0), card("c", 900, 0)];
    const updates = organizeCards(cards, cards.map((item) => item.id), "distributeX");
    expect(updates).toEqual([{ id: "b", x: 450, y: 0 }]);
    expect(cards.map((item) => item.x)).toEqual([0, 350, 900]);
  });

  it("aligns only a selected branch and preserves all other coordinates", () => {
    const cards = [card("root", 600, 260), card("a", 970, 100), card("b", 960, 340), card("c", 980, 510), card("other", 100, 100)];
    const updates = arrangeSubtree(cards, [edge("root", "a"), edge("root", "b"), edge("root", "c"), edge("other", "root")], "root");
    expect(updates.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(updates.map((item) => item.x)).toEqual([878, 878, 878]);
    expect(updates.map((item) => item.y)).toEqual([96, 260, 424]);
    expect(cards.find((item) => item.id === "other")?.x).toBe(100);
    expect(cards.find((item) => item.id === "root")?.y).toBe(260);
  });
});

import { describe, expect, it } from "vitest";
import { demoRelations, layoutFocus, layoutOverview, relationVisual, scoreObservedRelations, type OrbPoint } from "./relation-focus";

const points: OrbPoint[] = [
  { id: "automation", x: 39, y: 28, depth: .55, width: 92 },
  { id: "coding", x: 72, y: 22, depth: .94, width: 114 },
  { id: "ai", x: 21, y: 29, depth: .82, width: 20 },
  { id: "control", x: 50, y: 50, depth: .7, width: 64 },
  { id: "math", x: 49, y: 10, depth: .72, width: 42 },
  { id: "embedded", x: 50, y: 50, depth: .6, width: 92 },
  { id: "sensors", x: 50, y: 50, depth: .5, width: 62 },
  { id: "design", x: 83, y: 44, depth: .58, width: 60 },
  { id: "life", x: 75, y: 73, depth: .38, width: 28 },
];

const distance = (point: { x: number; y: number }) => Math.hypot(point.x - 50, point.y - 50);

describe("relation focus", () => {
  it("maps observed relation strength into a bounded score", () => {
    const relations = scoreObservedRelations([
      { fromCanvasId: "a", toCanvasId: "b", strength: 9 },
      { fromCanvasId: "a", toCanvasId: "c", strength: 2 },
    ], new Set(["a", "b", "c"]));
    expect(relations[0].score).toBeGreaterThan(relations[1].score);
    expect(relations.every((relation) => relation.score >= 0 && relation.score <= 1)).toBe(true);
  });

  it("centers the selected demo domain and ranks its neighbors by score", () => {
    const placed = layoutFocus(points, "automation", demoRelations, 620, "en");
    const byId = new Map(placed.map((point) => [point.id, point]));
    expect(byId.get("automation")).toMatchObject({ x: 50, y: 50, opacity: 1 });
    expect(distance(byId.get("coding")!)).toBeLessThan(distance(byId.get("math")!));
    expect(distance(byId.get("ai")!)).toBeLessThan(distance(byId.get("embedded")!));
    expect(byId.get("design")?.hidden).toBe(true);
    expect(byId.get("life")?.opacity).toBe(0);
  });

  it("keeps visual strength out of the UI component", () => {
    expect(relationVisual(.92).fontSize).toBeGreaterThan(relationVisual(.52).fontSize);
    expect(relationVisual(.92).opacity).toBeGreaterThan(relationVisual(.18).opacity);
    expect(relationVisual(.92).distance).toBeLessThan(relationVisual(.52).distance);
  });

  it("accounts for wider English text when resolving overview collisions", () => {
    const crowded: OrbPoint[] = [
      { id: "programming", x: 48, y: 28, depth: .8, width: 118 },
      { id: "automation", x: 53, y: 29, depth: .7, width: 96 },
    ];
    const placed = layoutOverview(crowded, 560, "en");
    expect(Math.abs(placed[0].x - placed[1].x) * 5.6 >= (118 + 96) * 1.25 / 2 + 8 || Math.abs(placed[0].y - placed[1].y) * 5.6 >= 34).toBe(true);
  });
});

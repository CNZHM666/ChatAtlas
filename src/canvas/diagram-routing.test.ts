import { describe, expect, it } from "vitest";
import { routeCongestion, routeDiagram, routeSegments } from "./diagram-routing";

describe("diagram edge clearance", () => {
  it("routes around an occupied corridor instead of tracing the existing edge", () => {
    const occupied = [{ from: { x: 40, y: 100 }, to: { x: 160, y: 100 } }];
    const path = routeDiagram({ x: 0, y: 100 }, { x: 200, y: 100 }, [], { width: 220, height: 200 }, [], occupied);
    expect(path[0]).toEqual({ x: 0, y: 100 });
    expect(path.at(-1)).toEqual({ x: 200, y: 100 });
    expect(path.some(point => Math.abs(point.y - 100) >= 10)).toBe(true);
    expect(routeSegments(path).reduce((sum, { from, to }) => sum + routeCongestion(from, to, occupied), 0)).toBe(0);
  });

  it("still avoids nodes when an existing edge occupies the nearest detour", () => {
    const box = { id: "module", x: 80, y: 70, width: 40, height: 60 };
    const occupied = [{ from: { x: 60, y: 52 }, to: { x: 140, y: 52 } }];
    const path = routeDiagram({ x: 0, y: 100 }, { x: 200, y: 100 }, [box], { width: 220, height: 200 }, [], occupied);
    expect(path.length).toBeGreaterThan(2);
    for (const { from, to } of routeSegments(path)) {
      const crosses = from.y === to.y
        ? from.y > box.y && from.y < box.y + box.height && Math.min(from.x, to.x) < box.x + box.width && Math.max(from.x, to.x) > box.x
        : from.x > box.x && from.x < box.x + box.width && Math.min(from.y, to.y) < box.y + box.height && Math.max(from.y, to.y) > box.y;
      expect(crosses).toBe(false);
      expect(routeCongestion(from, to, occupied)).toBe(0);
    }
  });
});

import { describe, expect, it } from "vitest";
import { cardEdgeDirection, routeOrthogonal } from "./edge-geometry";

describe("obstacle-aware routing", () => {
  it("connects horizontal questions at their facing sides and vertical questions at top and bottom", () => {
    const first = { x: 0, y: 0, width: 258, height: 96 };
    expect(cardEdgeDirection(first, { x: 320, y: 0, width: 258, height: 96 })).toBe("right");
    expect(cardEdgeDirection(first, { x: 0, y: 190, width: 258, height: 96 })).toBe("bottom");
    expect(cardEdgeDirection(first, { x: -320, y: 0, width: 258, height: 96 })).toBe("left");
  });
  it("uses a clear lane when a card occupies the direct route", () => {
    const obstacle = { x: 80, y: -30, width: 90, height: 70 };
    const points = routeOrthogonal({ x: 0, y: 0 }, { x: 240, y: 0 }, [obstacle]);
    expect(points.length).toBeGreaterThan(2);
    const segments = points.slice(1).map((point, index) => [points[index], point] as const);
    expect(segments.every(([a, b]) => a.y === b.y ? a.y <= obstacle.y - 12 || a.y >= obstacle.y + obstacle.height + 12 || Math.max(a.x, b.x) <= obstacle.x - 12 || Math.min(a.x, b.x) >= obstacle.x + obstacle.width + 12 : a.x <= obstacle.x - 12 || a.x >= obstacle.x + obstacle.width + 12 || Math.max(a.y, b.y) <= obstacle.y - 12 || Math.min(a.y, b.y) >= obstacle.y + obstacle.height + 12)).toBe(true);
  });
});

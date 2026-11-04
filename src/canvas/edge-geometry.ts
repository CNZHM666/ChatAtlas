export function sharedTrunkX(sourceX: number, targetXs: number[]): number {
  if (!targetXs.length) return sourceX;
  const right = targetXs.every((x) => x > sourceX);
  const left = targetXs.every((x) => x < sourceX);
  if (right) return sourceX + Math.min(44, Math.max(16, (Math.min(...targetXs) - sourceX) / 2));
  if (left) return sourceX - Math.min(44, Math.max(16, (sourceX - Math.max(...targetXs)) / 2));
  return (sourceX + targetXs[0]) / 2;
}

export interface EdgeObstacle { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number };
export type CardEdgeDirection = "left" | "right" | "top" | "bottom";

/** Pick the facing card sides from their current positions, including moved cards. */
export function cardEdgeDirection(source: EdgeObstacle, target: EdgeObstacle): CardEdgeDirection {
  const dx = target.x + target.width / 2 - source.x - source.width / 2;
  const dy = target.y + target.height / 2 - source.y - source.height / 2;
  const horizontalGap = Math.abs(dx) - (source.width + target.width) / 2;
  const verticalGap = Math.abs(dy) - (source.height + target.height) / 2;
  return horizontalGap >= verticalGap ? dx >= 0 ? "right" : "left" : dy >= 0 ? "bottom" : "top";
}

function crossesObstacle(a: Point, b: Point, obstacle: EdgeObstacle, padding = 12): boolean {
  const left = obstacle.x - padding;
  const right = obstacle.x + obstacle.width + padding;
  const top = obstacle.y - padding;
  const bottom = obstacle.y + obstacle.height + padding;
  if (a.y === b.y) return a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right;
  return a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom;
}

/** Choose a clear orthogonal lane around measured nodes without moving authored positions. */
export function routeOrthogonal(source: Point, target: Point, obstacles: EdgeObstacle[] = [], axis: "horizontal" | "vertical" = "horizontal"): Point[] {
  const xLanes = [(source.x + target.x) / 2, ...obstacles.flatMap((item) => [item.x - 18, item.x + item.width + 18])];
  const yLanes = [(source.y + target.y) / 2, ...obstacles.flatMap((item) => [item.y - 18, item.y + item.height + 18])];
  const candidates: Point[][] = [
    [source, target],
    ...xLanes.map((x) => [source, { x, y: source.y }, { x, y: target.y }, target]),
    ...yLanes.map((y) => [source, { x: source.x, y }, { x: target.x, y }, target]),
  ];
  const scored = candidates.filter((points) => points.every((point, index) => !index || point.x === points[index - 1].x || point.y === points[index - 1].y))
    .map((points) => {
      const segments = points.slice(1).map((point, index) => [points[index], point] as const).filter(([a, b]) => a.x !== b.x || a.y !== b.y);
      const collisions = segments.reduce((sum, [a, b]) => sum + obstacles.filter((obstacle) => crossesObstacle(a, b, obstacle)).length, 0);
      const length = segments.reduce((sum, [a, b]) => sum + Math.abs(a.x - b.x) + Math.abs(a.y - b.y), 0);
      const first = segments[0];
      const wrongFirstAxis = first && ((axis === "horizontal" && first[0].x === first[1].x) || (axis === "vertical" && first[0].y === first[1].y));
      return { points, score: collisions * 100_000 + length + Math.max(0, segments.length - 1) * 16 + (wrongFirstAxis ? 80 : 0) };
    }).sort((a, b) => a.score - b.score);
  const points = scored[0]?.points ?? [source, target];
  return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
}

export function roundedOrthogonalPath(points: Point[], radius = 9): string {
  if (!points.length) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    if (!next) { path += ` L ${current.x} ${current.y}`; continue; }
    const before = points[index - 1];
    const inLength = Math.abs(current.x - before.x) + Math.abs(current.y - before.y);
    const outLength = Math.abs(next.x - current.x) + Math.abs(next.y - current.y);
    if (!inLength || !outLength || (before.x === current.x && current.x === next.x) || (before.y === current.y && current.y === next.y)) { path += ` L ${current.x} ${current.y}`; continue; }
    const bend = Math.min(radius, inLength / 2, outLength / 2);
    const beforeBend = { x: current.x - Math.sign(current.x - before.x) * bend, y: current.y - Math.sign(current.y - before.y) * bend };
    const afterBend = { x: current.x + Math.sign(next.x - current.x) * bend, y: current.y + Math.sign(next.y - current.y) * bend };
    path += ` L ${beforeBend.x} ${beforeBend.y} Q ${current.x} ${current.y} ${afterBend.x} ${afterBend.y}`;
  }
  return path;
}

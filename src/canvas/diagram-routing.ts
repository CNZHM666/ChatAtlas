import type { DiagramBox } from "./diagram-layout";
export interface Point { x: number; y: number }
export interface RouteSegment { from: Point; to: Point }
export const routeSegments = (points: Point[]): RouteSegment[] => points.slice(1).map((to, index) => ({ from: points[index], to })).filter(({ from, to }) => from.x !== to.x || from.y !== to.y);

/** Penalize shared/nearby tracks more strongly than a single transverse crossing. */
export function routeCongestion(a: Point, b: Point, occupied: RouteSegment[]): number {
  const horizontal = a.y === b.y;
  return occupied.reduce((cost, { from, to }) => {
    const parallel = horizontal === (from.y === to.y);
    if (parallel) {
      const distance = horizontal ? Math.abs(a.y - from.y) : Math.abs(a.x - from.x);
      const overlap = horizontal
        ? Math.min(Math.max(a.x, b.x), Math.max(from.x, to.x)) - Math.max(Math.min(a.x, b.x), Math.min(from.x, to.x))
        : Math.min(Math.max(a.y, b.y), Math.max(from.y, to.y)) - Math.max(Math.min(a.y, b.y), Math.min(from.y, to.y));
      return cost + (distance < 10 && overlap > 0 ? overlap * (10 - distance) * 4 : 0);
    }
    const x = horizontal ? from.x : a.x, y = horizontal ? a.y : from.y;
    const inside = (value: number, start: number, end: number) => value >= Math.min(start, end) && value <= Math.max(start, end);
    const crosses = inside(x, a.x, b.x) && inside(y, a.y, b.y) && inside(x, from.x, to.x) && inside(y, from.y, to.y);
    return cost + (crosses ? 160 : 0);
  }, 0);
}

export function routeCost(points: Point[], occupied: RouteSegment[]): number {
  const segments = routeSegments(points);
  return segments.reduce((cost, { from, to }, index) => cost + Math.abs(from.x - to.x) + Math.abs(from.y - to.y) + routeCongestion(from, to, occupied)
    + (index && (segments[index - 1].from.x === segments[index - 1].to.x) !== (from.x === to.x) ? 24 : 0), 0);
}
export const boxesOverlap = (a: DiagramBox, b: DiagramBox) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Orthogonal visibility grid: only clear horizontal/vertical segments are traversable. */
export function routeDiagram(start: Point, end: Point, boxes: DiagramBox[], bounds: { width: number; height: number }, tracks: Point[] = [], occupied: RouteSegment[] = []): Point[] {
  // Add clearance tracks around existing edges, rather than routing on top of them.
  tracks = [...tracks, ...occupied.flatMap(({ from, to }) => from.x === to.x
    ? [{ x: from.x - 12, y: from.y }, { x: from.x + 12, y: to.y }]
    : [{ x: from.x, y: from.y - 12 }, { x: to.x, y: from.y + 12 }])];
  const xs = [...new Set([16, bounds.width - 16, start.x, end.x, ...tracks.map(p => p.x), ...boxes.flatMap(box => [box.x - 18, box.x + box.width + 18])])].sort((a, b) => a - b);
  const ys = [...new Set([16, bounds.height - 16, start.y, end.y, ...tracks.map(p => p.y), ...boxes.flatMap(box => [box.y - 18, box.y + box.height + 18])])].sort((a, b) => a - b);
  const obstacles = boxes.map(box => ({ ...box, x: box.x - 6, y: box.y - 6, width: box.width + 12, height: box.height + 12 }));
  const blocked = (a: Point, b: Point) => obstacles.some(box => a.x === b.x ? a.x > box.x && a.x < box.x + box.width && Math.min(a.y, b.y) < box.y + box.height && Math.max(a.y, b.y) > box.y : a.y > box.y && a.y < box.y + box.height && Math.min(a.x, b.x) < box.x + box.width && Math.max(a.x, b.x) > box.x);
  const columns = xs.length, encode = (x: number, y: number, direction: number) => (y * columns + x) * 3 + direction;
  const decode = (key: number) => ({ x: Math.floor(key / 3) % columns, y: Math.floor(Math.floor(key / 3) / columns), direction: key % 3 });
  const first = encode(xs.indexOf(start.x), ys.indexOf(start.y), 0), targetX = xs.indexOf(end.x), targetY = ys.indexOf(end.y);
  const costs = new Map([[first, 0]]), previous = new Map<number, number>();
  const queue: Array<{ key: number; score: number }> = [];
  const push = (item: typeof queue[number]) => { queue.push(item); let index = queue.length - 1; while (index) { const parent = Math.floor((index - 1) / 2); if (queue[parent].score <= item.score) break; queue[index] = queue[parent]; index = parent; } queue[index] = item; };
  const pop = () => { const top = queue[0], last = queue.pop()!; if (queue.length) { let index = 0; while (index * 2 + 1 < queue.length) { let child = index * 2 + 1; if (child + 1 < queue.length && queue[child + 1].score < queue[child].score) child++; if (queue[child].score >= last.score) break; queue[index] = queue[child]; index = child; } queue[index] = last; } return top; };
  push({ key: first, score: Math.abs(start.x - end.x) + Math.abs(start.y - end.y) });
  let finish: number | undefined;
  while (queue.length) {
    const { key } = pop(), here = decode(key), cost = costs.get(key)!;
    if (here.x === targetX && here.y === targetY) { finish = key; break; }
    for (const [x, y, direction] of [[here.x - 1, here.y, 1], [here.x + 1, here.y, 1], [here.x, here.y - 1, 2], [here.x, here.y + 1, 2]]) {
      if (x < 0 || x >= columns || y < 0 || y >= ys.length) continue;
      const a = { x: xs[here.x], y: ys[here.y] }, b = { x: xs[x], y: ys[y] };
      if (blocked(a, b)) continue;
      const next = encode(x, y, direction), candidate = cost + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (here.direction && here.direction !== direction ? 24 : 0) + routeCongestion(a, b, occupied);
      if (candidate >= (costs.get(next) ?? Infinity)) continue;
      costs.set(next, candidate); previous.set(next, key); push({ key: next, score: candidate + Math.abs(b.x - end.x) + Math.abs(b.y - end.y) });
    }
  }
  if (finish === undefined) return [];
  const result: Point[] = []; let cursor: number | undefined = finish;
  while (cursor !== undefined) { const point = decode(cursor); result.unshift({ x: xs[point.x], y: ys[point.y] }); cursor = previous.get(cursor); }
  return result.filter((point, index) => !index || index === result.length - 1 || !(result[index - 1].x === point.x && result[index + 1].x === point.x || result[index - 1].y === point.y && result[index + 1].y === point.y));
}

export function diagramLabelPosition(points: Point[], width: number, height: number, obstacles: DiagramBox[], id: string): DiagramBox | undefined {
  const candidates: Array<DiagramBox & { length: number }> = [];
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index], horizontal = a.y === b.y;
    const length = horizontal ? Math.abs(a.x - b.x) : Math.abs(a.y - b.y);
    if (length < (horizontal ? width : height) + 12) continue;
    const box = { id, x: (a.x + b.x - width) / 2, y: (a.y + b.y - height) / 2, width, height, length };
    const placements = horizontal ? [box, { ...box, y: box.y - height / 2 - 6 }, { ...box, y: box.y + height / 2 + 6 }] : [box, { ...box, x: box.x + width / 2 + 6 }, { ...box, x: box.x - width / 2 - 6 }];
    const clear = placements.find(candidate => !obstacles.some(obstacle => boxesOverlap(candidate, { ...obstacle, x: obstacle.x - 4, y: obstacle.y - 4, width: obstacle.width + 8, height: obstacle.height + 8 })));
    if (clear) candidates.push(clear);
  }
  return candidates.sort((a, b) => b.length - a.length)[0];
}

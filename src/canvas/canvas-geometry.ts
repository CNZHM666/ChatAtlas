import type { CanvasCard, CanvasEdge } from "../shared/types";

export interface Box { id: string; x: number; y: number; width: number; height: number }
export interface Guide { axis: "x" | "y"; coordinate: number; from: number; to: number }
export type OrganizeAction = "left" | "centerX" | "right" | "top" | "centerY" | "bottom" | "distributeX" | "distributeY" | "grid";

export function cardBox(card: CanvasCard): Box {
  return { id: card.id, x: card.x, y: card.y, width: card.kind === "conversation" ? 184 : card.kind === "bridge" ? 172 : 232, height: card.kind === "conversation" ? 68 : card.kind === "bridge" ? 48 : 128 };
}

const axisPoints = (box: Box, axis: "x" | "y") => axis === "x"
  ? [box.x, box.x + box.width / 2, box.x + box.width]
  : [box.y, box.y + box.height / 2, box.y + box.height];

/** Only local visible boxes are inspected during a drag; matching edges/centers win over spacing and grid. */
export function snapBox(moving: Box, others: Box[], threshold = 8): { x: number; y: number; guides: Guide[] } {
  const nearby = others.filter((box) => box.id !== moving.id && Math.abs(box.x - moving.x) < 520 && Math.abs(box.y - moving.y) < 400);
  const guides: Guide[] = [];
  const result = { x: moving.x, y: moving.y };
  for (const axis of ["x", "y"] as const) {
    let best: { distance: number; offset: number; guide: Guide } | undefined;
    for (const box of nearby) for (let index = 0; index < 3; index++) {
      const offset = axisPoints(box, axis)[index] - axisPoints(moving, axis)[index];
      if (Math.abs(offset) > threshold || (best && Math.abs(offset) >= best.distance)) continue;
      best = { distance: Math.abs(offset), offset, guide: axis === "x"
        ? { axis, coordinate: axisPoints(box, axis)[index], from: Math.min(box.y, moving.y) - 10, to: Math.max(box.y + box.height, moving.y + moving.height) + 10 }
        : { axis, coordinate: axisPoints(box, axis)[index], from: Math.min(box.x, moving.x) - 10, to: Math.max(box.x + box.width, moving.x + moving.width) + 10 } };
    }
    if (best) { result[axis] += best.offset; guides.push(best.guide); continue; }
    const before = nearby.filter((box) => axis === "x" ? box.x + box.width <= moving.x : box.y + box.height <= moving.y)
      .sort((a, b) => axis === "x" ? b.x - a.x : b.y - a.y)[0];
    const after = nearby.filter((box) => axis === "x" ? box.x >= moving.x + moving.width : box.y >= moving.y + moving.height)
      .sort((a, b) => axis === "x" ? a.x - b.x : a.y - b.y)[0];
    if (before && after) {
      const start = axis === "x" ? before.x + before.width : before.y + before.height;
      const end = axis === "x" ? after.x : after.y;
      const size = axis === "x" ? moving.width : moving.height;
      const centered = start + (end - start - size) / 2;
      if (Math.abs(centered - result[axis]) <= threshold) { result[axis] = centered; continue; }
    }
    const grid = Math.round(result[axis] / 8) * 8;
    if (Math.abs(grid - result[axis]) <= 2) result[axis] = grid;
  }
  return { ...result, guides };
}

/** Make a local slot for one card without disturbing any third card. */
export function insertionSpace(moving: Box, others: Box[], padding = 24): Array<{ id: string; x: number; y: number }> {
  const intersects = (a: Box, b: Box) => a.x < b.x + b.width + 12 && a.x + a.width + 12 > b.x && a.y < b.y + b.height + 12 && a.y + a.height + 12 > b.y;
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "width" : "height";
    const cross = axis === "x" ? "y" : "x";
    const crossSize = axis === "x" ? "height" : "width";
    const center = moving[axis] + moving[size] / 2;
    const crossCenter = moving[cross] + moving[crossSize] / 2;
    const aligned = others.filter((box) => Math.abs(box[cross] + box[crossSize] / 2 - crossCenter) <= 44);
    const before = aligned.filter((box) => box[axis] + box[size] / 2 < center).sort((a, b) => b[axis] - a[axis])[0];
    const after = aligned.filter((box) => box[axis] + box[size] / 2 > center).sort((a, b) => a[axis] - b[axis])[0];
    if (!before || !after) continue;
    const gap = after[axis] - before[axis] - before[size];
    const gapCenter = before[axis] + before[size] + gap / 2;
    const missing = moving[size] + padding * 2 - gap;
    if (missing <= 0 || missing > moving[size] * 1.5 || Math.abs(center - gapCenter) > 54) continue;
    const shift = missing / 2;
    const first: Box = { ...before, [axis]: before[axis] - shift };
    const second: Box = { ...after, [axis]: after[axis] + shift };
    if (others.some((box) => box.id !== before.id && box.id !== after.id && (intersects(first, box) || intersects(second, box)))) continue;
    return [{ id: first.id, x: first.x, y: first.y }, { id: second.id, x: second.x, y: second.y }];
  }
  return [];
}

/** Straighten a newly connected pair only when the move is small and collision free. */
export function alignConnectedBox(source: Box, target: Box, others: Box[], threshold = 22): { x: number; y: number } | null {
  const dx = target.x + target.width / 2 - source.x - source.width / 2;
  const dy = target.y + target.height / 2 - source.y - source.height / 2;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const aligned = horizontal
    ? { x: target.x, y: source.y + source.height / 2 - target.height / 2 }
    : { x: source.x + source.width / 2 - target.width / 2, y: target.y };
  const delta = horizontal ? Math.abs(aligned.y - target.y) : Math.abs(aligned.x - target.x);
  if (delta < 1 || delta > threshold) return null;
  const candidate = { ...target, ...aligned };
  if (others.some((box) => box.id !== source.id && box.id !== target.id && candidate.x < box.x + box.width + 12 && candidate.x + candidate.width + 12 > box.x && candidate.y < box.y + box.height + 12 && candidate.y + candidate.height + 12 > box.y)) return null;
  return aligned;
}

export function organizeCards(cards: CanvasCard[], ids: string[], action: OrganizeAction): Array<{ id: string; x: number; y: number }> {
  const selected = cards.filter((card) => ids.includes(card.id));
  if (selected.length < (action.startsWith("distribute") ? 3 : action === "grid" ? 1 : 2)) return [];
  const boxes = selected.map(cardBox);
  if (action === "distributeX" || action === "distributeY") {
    const axis = action === "distributeX" ? "x" : "y";
    const dimension = axis === "x" ? "width" : "height";
    const sorted = [...boxes].sort((a, b) => a[axis] - b[axis]);
    const first = sorted[0], last = sorted.at(-1)!;
    const totalMiddle = sorted.slice(1, -1).reduce((sum, box) => sum + box[dimension], 0);
    const gap = (last[axis] - first[axis] - first[dimension] - totalMiddle) / (sorted.length - 1);
    let cursor = first[axis] + first[dimension] + gap;
    return sorted.slice(1, -1).map((box) => { const position = { id: box.id, x: box.x, y: box.y }; position[axis] = cursor; cursor += box[dimension] + gap; return position; });
  }
  const left = Math.min(...boxes.map((box) => box.x)), right = Math.max(...boxes.map((box) => box.x + box.width));
  const top = Math.min(...boxes.map((box) => box.y)), bottom = Math.max(...boxes.map((box) => box.y + box.height));
  const centerX = boxes.reduce((sum, box) => sum + box.x + box.width / 2, 0) / boxes.length;
  const centerY = boxes.reduce((sum, box) => sum + box.y + box.height / 2, 0) / boxes.length;
  return boxes.map((box) => ({ id: box.id,
    x: action === "grid" ? Math.round(box.x / 8) * 8 : action === "left" ? left : action === "right" ? right - box.width : action === "centerX" ? centerX - box.width / 2 : box.x,
    y: action === "grid" ? Math.round(box.y / 8) * 8 : action === "top" ? top : action === "bottom" ? bottom - box.height : action === "centerY" ? centerY - box.height / 2 : box.y,
  }));
}

export function subtreeIds(cards: CanvasCard[], edges: CanvasEdge[], rootId: string): string[] {
  const known = new Set(cards.map((card) => card.id));
  const visited = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    if (!known.has(id) || visited.has(id)) continue;
    visited.add(id);
    queue.push(...edges.filter((edge) => edge.source === id && edge.relation !== "attachment").map((edge) => edge.target));
  }
  return [...visited];
}

/** Reposition descendants as one local transaction; the parent and every card outside the subtree stay put. */
export function arrangeSubtree(cards: CanvasCard[], edges: CanvasEdge[], rootId: string): Array<{ id: string; x: number; y: number }> {
  const root = cards.find((card) => card.id === rootId);
  if (!root) return [];
  const ids = new Set(subtreeIds(cards, edges, rootId));
  const byId = new Map(cards.filter((card) => ids.has(card.id)).map((card) => [card.id, card]));
  const children = (id: string) => edges.filter((edge) => edge.source === id && edge.relation !== "attachment" && ids.has(edge.target))
    .map((edge) => byId.get(edge.target)!).filter(Boolean).sort((a, b) => a.y - b.y);
  const direction = children(rootId).filter((card) => card.x < root.x).length > children(rootId).length / 2 ? -1 : 1;
  let leaf = 0;
  const positions = new Map<string, { depth: number; y: number }>();
  const visiting = new Set<string>();
  const place = (id: string, depth: number): number => {
    if (positions.has(id)) return positions.get(id)!.y;
    if (visiting.has(id)) return leaf++ * 164;
    visiting.add(id);
    const ys = children(id).filter((card) => !visiting.has(card.id)).map((card) => place(card.id, depth + 1));
    visiting.delete(id);
    const y = ys.length ? (ys[0] + ys.at(-1)!) / 2 : leaf++ * 164;
    positions.set(id, { depth, y });
    return y;
  };
  const rootY = place(rootId, 0);
  return [...positions].filter(([id]) => id !== rootId).map(([id, position]) => ({ id, x: root.x + direction * position.depth * 278, y: root.y + position.y - rootY }));
}

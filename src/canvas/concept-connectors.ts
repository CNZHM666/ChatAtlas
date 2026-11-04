import type { UnderstandingEdge } from "./understanding-model";

export type ConceptBox = { left: number; right: number; top: number; bottom: number };
export type ConceptConnector = { id: string; from: string; to: string; path: string; x: number; y: number; labelWidth: number; kind: UnderstandingEdge["kind"]; authored: boolean; feedback: boolean; root: boolean; compact?: boolean };
export const connectorKey = (edge: Pick<UnderstandingEdge, "from" | "to" | "kind">) => JSON.stringify([edge.from, edge.to, edge.kind]);
type Point = { x: number; y: number };
type Segment = { a: Point; b: Point; owner: string };
const center = (box: ConceptBox) => (box.left + box.right) / 2;
const touches = (segment: Segment, box: ConceptBox) => Math.min(segment.a.x, segment.b.x) < box.right + 5 && Math.max(segment.a.x, segment.b.x) > box.left - 5 && Math.min(segment.a.y, segment.b.y) < box.bottom + 5 && Math.max(segment.a.y, segment.b.y) > box.top - 5;
const intersects = (a: Segment, b: Segment) => Math.min(a.a.x, a.b.x) <= Math.max(b.a.x, b.b.x) && Math.max(a.a.x, a.b.x) >= Math.min(b.a.x, b.b.x) && Math.min(a.a.y, a.b.y) <= Math.max(b.a.y, b.b.y) && Math.max(a.a.y, a.b.y) >= Math.min(b.a.y, b.b.y);

/** Short tree connectors only. Dense cross-links stay in the named relation list. */
export function conceptConnectors(boxes: Map<string, ConceptBox>, edges: UnderstandingEdge[], rank: Map<string, number>, width: number, root?: ConceptBox, labelWidths?: Map<string, number>): ConceptConnector[] {
  const result: ConceptConnector[] = [], occupied: Segment[] = [], labels: ConceptBox[] = [], targets = new Set<string>();
  const add = (edge: UnderstandingEdge, points: Point[], rootLink = false) => {
    const segments = points.slice(1).map((point, index) => ({ a: points[index], b: point, owner: edge.from }));
    if ([...boxes].some(([id, box]) => id !== edge.from && id !== edge.to && segments.some(segment => touches(segment, box)))) return false;
    if (occupied.some(other => other.owner !== edge.from && segments.some(segment => intersects(segment, other)))) return false;
    const feedback = edge.kind === "feedback", last = points.at(-1)!;
    const labelWidth = labelWidths?.get(connectorKey(edge)) ?? 84;
    const x = feedback ? points[1].x - labelWidth / 2 - 1 : last.x, y = feedback ? (points[0].y + last.y) / 2 : points[1].y - 2;
    const label = { left: x - labelWidth / 2, right: x + labelWidth / 2, top: y - 12, bottom: y + 12 };
    if (!rootLink && edge.kind !== "contains" && labels.some(box => label.left < box.right + 6 && label.right > box.left - 6 && label.top < box.bottom + 4 && label.bottom > box.top - 4)) return false;
    occupied.push(...segments);
    if (!rootLink && edge.kind !== "contains") labels.push(label);
    result.push({ id: rootLink ? `root:${edge.to}` : connectorKey(edge), from: edge.from, to: edge.to, kind: edge.kind, path: points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" "), x, y, labelWidth, feedback, authored: Boolean(edge.authored), root: rootLink });
    return true;
  };
  // Do not run decorative root branches around wrapped rows or lower-level nodes.
  if (root && boxes.size > 1) {
    const firstTop = Math.min(...[...boxes.values()].map(box => box.top));
    for (const [id, box] of boxes) if (Math.abs(box.top - firstTop) < 4 && !edges.some(edge => edge.to === id && !["comparison", "feedback"].includes(edge.kind))) {
      const bus = box.top - 20;
      add({ from: "", to: id, kind: "contains", excerpt: "" }, [{ x: center(root), y: root.bottom }, { x: center(root), y: bus }, { x: center(box), y: bus }, { x: center(box), y: box.top - 4 }], true);
    }
  }
  const forward = edges.filter(edge => !["comparison", "feedback"].includes(edge.kind) && rank.get(edge.to) === (rank.get(edge.from) ?? -2) + 1);
  for (const edge of forward) {
    const from = boxes.get(edge.from), to = boxes.get(edge.to);
    if (!from || !to || targets.has(edge.to) || to.top - from.bottom < 28) continue;
    const bus = (from.bottom + to.top) / 2;
    if (add(edge, [{ x: center(from), y: from.bottom }, { x: center(from), y: bus }, { x: center(to), y: bus }, { x: center(to), y: to.top - 4 }])) targets.add(edge.to);
  }
  // Feedback has its own outside channel, with enough room for a readable label.
  const outside = Math.max(0, ...[...boxes.values()].map(box => box.right));
  let lane = outside + Math.max(96, ...edges.filter(edge => edge.kind === "feedback").map(edge => (labelWidths?.get(connectorKey(edge)) ?? 84) + 12));
  for (const edge of edges.filter(edge => edge.kind === "feedback")) {
    const from = boxes.get(edge.from), to = boxes.get(edge.to);
    if (!from || !to || lane > width - 8) continue;
    const y1 = (from.top + from.bottom) / 2, y2 = (to.top + to.bottom) / 2;
    if (add(edge, [{ x: from.right, y: y1 }, { x: lane, y: y1 }, { x: lane, y: y2 }, { x: to.right + 4, y: y2 }])) lane += 16;
  }
  return result;
}

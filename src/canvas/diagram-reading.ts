import type { UnderstandingEdge } from "./understanding-model";

/** A readable backbone, not an inferred relationship: every edge comes from the saved structure. */
export function diagramReadingEdges(edges: UnderstandingEdge[]): UnderstandingEdge[] {
  const next = new Map<string, Set<string>>();
  const neighbours = new Map<string, Set<string>>();
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return [...next.get(from) ?? []].some(id => reaches(id, to, seen));
  };
  const chosen = new Set<UnderstandingEdge>();
  const connected = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return [...neighbours.get(from) ?? []].some(id => connected(id, to, seen));
  };
  const priority = (edge: UnderstandingEdge) => edge.kind === "contains" ? 0 : edge.kind === "requires" || edge.kind === "flow" ? 1 : edge.kind === "example" ? 2 : 3;
  for (const edge of [...edges].sort((a, b) => priority(a) - priority(b))) {
    if (edge.uncertain || edge.kind === "feedback") continue;
    if (reaches(edge.to, edge.from)) continue;
    if (edge.kind === "comparison" && connected(edge.from, edge.to)) continue;
    const targets = next.get(edge.from) ?? new Set<string>();
    targets.add(edge.to); next.set(edge.from, targets); chosen.add(edge);
    for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const adjacent = neighbours.get(from) ?? new Set<string>();
      adjacent.add(to); neighbours.set(from, adjacent);
    }
  }
  return edges.filter(edge => chosen.has(edge));
}

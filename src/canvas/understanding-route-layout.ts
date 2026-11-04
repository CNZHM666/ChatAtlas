import type { UnderstandingEdge } from "./understanding-model";
import type { FocusSection } from "../shared/focus-session";

export interface UnderstandingGroup { id: string; title: string; items: FocusSection[]; start: number }

/** Group consecutive items only: visual grouping must never rewrite the saved reading order. */
export function readingRouteGroups(sections: FocusSection[], chapter: boolean): UnderstandingGroup[] {
  const byTitle = new Map<string, FocusSection[]>();
  sections.forEach(section => byTitle.set(section.title, [...(byTitle.get(section.title) ?? []), section]));
  const root = (section: FocusSection) => {
    const seen = new Set([section.id]);
    let current = section;
    while (current.phase) {
      const parents = byTitle.get(current.phase);
      if (parents?.length !== 1) return current.phase;
      if (seen.has(parents[0].id)) return "";
      current = parents[0]; seen.add(current.id);
    }
    return current === section ? "" : current.title;
  };
  const roots = chapter ? new Map(sections.map(section => [section.id, root(section)])) : new Map<string, string>();
  const parentTitles = new Set([...roots.values()].filter(Boolean));
  const groups: UnderstandingGroup[] = [];
  sections.forEach((section, index) => {
    const title = chapter ? roots.get(section.id) || (parentTitles.has(section.title) && byTitle.get(section.title)?.length === 1 ? section.title : "") : section.phase?.trim() ?? "";
    const previous = groups.at(-1);
    if (previous && previous.title === title && (title || chapter || sections.length <= 6 || previous.items.length < 4)) previous.items.push(section);
    else groups.push({ id: `route-group:${section.id}`, title, items: [section], start: index });
  });
  return groups;
}

/** Bound the overview's expanded maps without guessing themes or changing saved order. */
export function overviewRouteGroups(sections: FocusSection[]): UnderstandingGroup[] {
  return readingRouteGroups(sections, false).flatMap(group => {
    if (group.items.length <= 6) return [group];
    return Array.from({ length: Math.ceil(group.items.length / 4) }, (_, index) => {
      const items = group.items.slice(index * 4, index * 4 + 4);
      return { id: `route-group:${items[0].id}`, title: group.title, items, start: group.start + index * 4 };
    });
  });
}

/** Indentation expresses unique heading containment, never a prerequisite. */
export function routeDepth(section: FocusSection, sections: FocusSection[]): number {
  const seen = new Set([section.id]);
  let current = section, depth = 0;
  while (current.phase) {
    const parents = sections.filter(candidate => candidate.title === current.phase);
    if (parents.length !== 1 || seen.has(parents[0].id)) return 0;
    current = parents[0]; seen.add(current.id); depth++;
  }
  return Math.min(3, depth);
}

/** Explicit relationships set levels; disconnected points remain independent. */
export function conceptLevels(sections: FocusSection[], edges: UnderstandingEdge[]): FocusSection[][] {
  const directional = edges.filter(edge => !["comparison", "feedback"].includes(edge.kind));
  const incoming = new Map(sections.map(item => [item.id, new Set(directional.filter(edge => edge.to === item.id).map(edge => edge.from)).size]));
  const outgoing = new Map(sections.map(item => [item.id, [...new Set(directional.filter(edge => edge.from === item.id).map(edge => edge.to))]]));
  const rank = new Map(sections.map(item => [item.id, 0]));
  const queue = sections.filter(item => !incoming.get(item.id)).map(item => item.id);
  for (let index = 0; index < queue.length; index++) for (const id of outgoing.get(queue[index]) ?? []) {
    rank.set(id, Math.max(rank.get(id) ?? 0, (rank.get(queue[index]) ?? 0) + 1));
    incoming.set(id, (incoming.get(id) ?? 0) - 1);
    if (!incoming.get(id)) queue.push(id);
  }
  const visited = new Set(queue);
  sections.filter(item => !visited.has(item.id)).forEach(item => rank.set(item.id, 0));
  return Array.from({ length: Math.max(0, ...rank.values()) + 1 }, (_, level) => sections.filter(item => rank.get(item.id) === level)).filter(level => level.length);
}

/** Keep a small tree's descendants below their parent; extra cross-links do not move nodes. */
export function conceptTreeSlots(sections: FocusSection[], downward: UnderstandingEdge[]) {
  const parents = new Map<string, string>();
  downward.forEach(edge => { if (!parents.has(edge.to)) parents.set(edge.to, edge.from); });
  const children = new Map(sections.map(item => [item.id, sections.filter(child => parents.get(child.id) === item.id)]));
  const width = (id: string): number => Math.max(1, (children.get(id) ?? []).reduce((total, child) => total + width(child.id), 0));
  const slots = new Map<string, { start: number; span: number }>();
  const place = (id: string, start: number) => {
    slots.set(id, { start, span: width(id) });
    let position = start;
    for (const child of children.get(id) ?? []) { place(child.id, position); position += width(child.id); }
  };
  let count = 0;
  sections.filter(item => !parents.has(item.id)).forEach(item => { place(item.id, count); count += width(item.id); });
  return { slots, count };
}

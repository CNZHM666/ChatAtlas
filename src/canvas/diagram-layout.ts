import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api";
import type { FocusSection } from "../shared/focus-session";
import type { UnderstandingEdge } from "./understanding-model";
import { understandingRelationText } from "./understanding-model";
import { connectorKey } from "./concept-connectors";
import type { MapGroup } from "./map-presentation";
import { evidencePresentation } from "./evidence-presentation";
import { understandingSummary } from "./understanding-summary";
import { diagramReadingEdges } from "./diagram-reading";
import { diagramLabelPosition, routeDiagram, routeCost, routeSegments } from "./diagram-routing";

export interface DiagramBox { id: string; x: number; y: number; width: number; height: number }
export interface DiagramLink { id: string; paths: string[]; labels: Array<DiagramBox & { lines: string[] }> }
export interface DiagramLayout { width: number; height: number; nodes: DiagramBox[]; groups: Array<DiagramBox & { title: string }>; links: DiagramLink[] }
export interface DiagramInput { sections: FocusSection[]; edges: UnderstandingEdge[]; groups?: MapGroup[]; zh: boolean; review?: boolean; architecture?:boolean; showDetails?: boolean; simple?: boolean; wide?: boolean; labels?: boolean; compactLabels?: boolean; direction?: "RIGHT" | "DOWN" }

/** Measure complete labels conservatively without a font download or a DOM measurement cycle. */
export function diagramTextLines(text: string, units = 18): string[] {
  const lines: string[] = []; let line = "", size = 0;
  const measure = (value: string) => [...value].reduce((n, char) => n + (char.codePointAt(0)! > 255 ? 1 : .55), 0);
  const clauses = text.match(/[^，。；！？,;!?]+[，。；！？,;!?]*|[，。；！？,;!?]+/gu) ?? [];
  // Prefer a complete clause to breaking a technical term in the middle.
  if (measure(text) > units && clauses.length > 1 && clauses.every(clause => measure(clause) <= units)) {
    for (const clause of clauses) { if (line && measure(line + clause) > units) { lines.push(line); line = ""; } line += clause; }
    if (line) lines.push(line);
    return lines;
  }
  const words = text.match(/[a-zA-Z0-9_-]+|需要|通过|基于|对应|包含|反馈|形成|生成|输出|前提|条件|否则|因此|[^a-zA-Z0-9_-]/gu) ?? [];
  const total = measure(text);
  const target = total > units ? total / Math.ceil(total / units) : units;
  for (const word of words) {
    const length = [...word].reduce((n, char) => n + (char.codePointAt(0)! > 255 ? 1 : .55), 0);
    if (size && size + length > target && !/^[，。；！？、,.!?;:：\s]$/u.test(word)) { lines.push(line); line = ""; size = 0; }
    // Preserve long technical names; the node/label widens to fit the indivisible word.
    line += word; size += length;
  }
  if (line.trim()) lines.push(line);
  return lines.length ? lines : [text];
}
const textWidth = (text: string, size: number) => [...text].reduce((n, char) => n + (char.codePointAt(0)! > 255 ? size : size * .58), 0);

export function createDiagramGraph(input: DiagramInput) {
  const direction = input.direction ?? (input.review && !input.wide ? "DOWN" : "RIGHT");
  const packing = { "elk.aspectRatio": direction === "RIGHT" ? "2.4" : input.architecture ? "1.2" : "0.6", "elk.separateConnectedComponents": "true", "elk.spacing.componentComponent": "40", "elk.layered.considerModelOrder.components": input.architecture ? "NONE" : "FORCE_MODEL_ORDER" };
  const nodeIds = new Map(input.sections.map((node, index) => [node.id, `n${index}`]));
  const originalIds = new Map([...nodeIds].map(([id, key]) => [key, id]));
  const groupNames = new Map<string, string>(), ownership = new Map<string, ElkNode>();
  const edgeKeys = new Map<string, string>(), edgeKinds = new Map<string, UnderstandingEdge["kind"]>(), labelLines = new Map<string, string[]>();
  const measured = input.sections.map(node => {
    const title = node.origin || node.userEdited ? node.title : evidencePresentation(node.title);
    const lines = diagramTextLines(title, 13);
    const summary = input.showDetails ? understandingSummary(node) : "";
    const detailLines = summary && summary !== title ? Math.min(3, diagramTextLines(summary, 16).length) : 0;
    const ioLines = input.showDetails ? [node.inputs, node.outputs].reduce((sum, values) => sum + (values?.length ? Math.min(2, diagramTextLines(values.join(" · "), 18).length) : 0), 0) : 0;
    const width = Math.max(input.showDetails ? 240 : 160, ...lines.map(line => textWidth(line, 15) + 32));
    const height = Math.max(input.showDetails ? 90 : 52, lines.length * 22 + (detailLines ? 6 + detailLines * 20 : 0) + (ioLines ? 12 + ioLines * 18 : 0) + 28);
    return { node, width, height };
  });
  // A single card measure keeps branch rows aligned, including mixed title lengths.
  const cardWidth = Math.max(160, ...measured.map(item => item.width));
  const cardHeight = Math.max(52, ...measured.map(item => item.height));
  const children: ElkNode[] = measured.map(({ node }) => {
    const width = cardWidth, height = cardHeight;
    return { id: nodeIds.get(node.id)!, width, height, ports: [], layoutOptions: { "elk.portConstraints": "FIXED_SIDE" } };
  });
  const grouped = new Set<string>();
  const compounds: ElkNode[] = (input.groups ?? []).filter(group => group.items.length).map((group, index) => {
    const ids = new Set(group.items.map(item => nodeIds.get(item.id)).filter(Boolean));
    const members = children.filter(node => ids.has(node.id) && !grouped.has(node.id));
    members.forEach(node => grouped.add(node.id));
    const parent: ElkNode = { id: `g${index}`, children: members, edges: [], layoutOptions: { ...packing, "elk.algorithm": "layered", "elk.direction": direction, "elk.padding": "[top=38,left=16,bottom=16,right=16]", "elk.spacing.nodeNode": "32", "elk.layered.spacing.nodeNodeBetweenLayers": "44", "elk.nodeSize.minimum": `(${Math.max(160, textWidth(group.title, 14) + 32)},100)` } };
    groupNames.set(parent.id, group.title); members.forEach(node => ownership.set(node.id, parent));
    return parent;
  }).filter(group => group.children?.length);
  const graph: ElkNode = { id: "root", children: [...compounds, ...children.filter(node => !grouped.has(node.id))], edges: [], layoutOptions: {
    ...packing, "elk.algorithm": "layered", "elk.direction": direction, "elk.edgeRouting": "ORTHOGONAL", "elk.hierarchyHandling": "SEPARATE_CHILDREN",
    "elk.padding": "[top=24,left=24,bottom=24,right=24]", "elk.spacing.nodeNode": input.showDetails ? "40" : "32", "elk.spacing.edgeNode": "16", "elk.spacing.edgeEdge": "12",
    "elk.layered.spacing.nodeNodeBetweenLayers": input.showDetails ? "48" : "36", "elk.layered.spacing.edgeNodeBetweenLayers": "16", "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
    "elk.layered.mergeEdges": "false", "elk.layered.mergeHierarchyEdges": "false",
    "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX", "elk.layered.nodePlacement.favorStraightEdges": "true",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES", "elk.randomSeed": "1",
  } };
  const byId = new Map(children.map(node => [node.id, node]));
  const comparisons: UnderstandingEdge[] = [], feedback: UnderstandingEdge[] = [];
  const forward = diagramReadingEdges(input.edges).filter(edge => edge.kind !== "comparison");
  const forwardEdges = new Set(forward);
  input.edges.filter(edge => !edge.uncertain && nodeIds.has(edge.from) && nodeIds.has(edge.to)).forEach((edge, index) => {
    const id = `e${index}`, from = nodeIds.get(edge.from)!, to = nodeIds.get(edge.to)!;
    const text = input.compactLabels ? edge.label ?? "" : understandingRelationText(edge, input.zh, false), lines = diagramTextLines(text, input.simple ? 11 : 14);
    const labelId = `${id}:label`; edgeKeys.set(id, connectorKey(edge)); edgeKinds.set(id, edge.kind); labelLines.set(labelId, lines);
    // A comparison is not a rank/dependency. Route it around the final boxes,
    // so showing comparisons cannot turn sibling concepts into causal steps.
    if (edge.kind === "comparison") { comparisons.push(edge); return; }
    // Return connections must not change forward ranks or widen the main pipeline.
    // Route them after the forward graph, on reserved exterior lanes.
    if (edge.kind === "feedback" || !forwardEdges.has(edge)) { feedback.push(edge); return; }
    // Separate ports let ELK order parallel branches without overlapping arrowheads.
    const sourceSide = direction === "RIGHT" ? "EAST" : "SOUTH";
    const targetSide = direction === "RIGHT" ? "WEST" : "NORTH";
    const port = (node: string, end: string, side: string) => {
      const key = `${node}:${id}:${end}`;
      byId.get(node)!.ports!.push({ id: key, width: 0, height: 0, layoutOptions: { "elk.port.side": side } });
      return key;
    };
    const elkEdge: ElkExtendedEdge = { id, sources: [port(from, "out", sourceSide)], targets: [port(to, "in", targetSide)], labels: input.labels === false || !text ? [] : [{ id: labelId, text, width: Math.max(48, ...lines.map(line => textWidth(line, 14) + 22)), height: lines.length * 20 + 10, layoutOptions: { "elk.edgeLabels.placement": "CENTER", "elk.edgeLabels.inline": "true" } }], layoutOptions: { "elk.layered.priority.direction": "10" } };
    const parent = ownership.get(from);
    // INCLUDE_CHILDREN disables independent-component packing in ELK. Only
    // enable it for actual cross-group edges; isolated cards otherwise form
    // one narrow rank and direction changes appear to do nothing.
    if (parent !== ownership.get(to) && (parent || ownership.has(to))) graph.layoutOptions!["elk.hierarchyHandling"] = "INCLUDE_CHILDREN";
    (parent && parent === ownership.get(to) ? parent.edges! : graph.edges!).push(elkEdge);
  });
  // Give the native cycle breaker a dependency order, so feedback returns around
  // the forward path instead of moving the entry point behind its outputs.
  const orderChildren = (parent: ElkNode) => {
    const members = parent.children ?? [];
    const descendantIds = (node: ElkNode): string[] => node.children ? node.children.flatMap(descendantIds) : [node.id];
    const owners = new Map(members.flatMap(node => descendantIds(node).map(id => [id, node.id] as const)));
    const dependencies = new Map(members.map(node => [node.id, new Set<string>()]));
    for (const edge of forward) {
      const from = owners.get(nodeIds.get(edge.from)!), to = owners.get(nodeIds.get(edge.to)!);
      if (from && to && from !== to) dependencies.get(to)!.add(from);
    }
    const pending = [...members], ordered: ElkNode[] = [];
    while (pending.length) {
      const index = pending.findIndex(node => !dependencies.get(node.id)!.size);
      const node = pending.splice(index < 0 ? 0 : index, 1)[0];
      ordered.push(node); dependencies.forEach(ids => ids.delete(node.id));
    }
    parent.children = ordered;
    for (const child of ordered) if (child.children) {
      orderChildren(child);
    }
  };
  orderChildren(graph);
  return { graph, originalIds, groupNames, edgeKeys, edgeKinds, labelLines, comparisons, feedback, direction, labels: input.labels !== false, compactLabels: input.compactLabels, zh: input.zh };
}

export function flattenDiagram(graph: ElkNode, metadata: ReturnType<typeof createDiagramGraph>): DiagramLayout {
  const nodes: DiagramBox[] = [], groups: DiagramLayout["groups"] = [], links: DiagramLink[] = [];
  const visit = (parent: ElkNode, x: number, y: number) => {
    for (const edge of parent.edges ?? []) {
      links.push({ id: metadata.edgeKeys.get(edge.id)!, paths: (edge.sections ?? []).map(section => {
        const points = [section.startPoint, ...section.bendPoints ?? [], section.endPoint].map(point => ({ x: point.x + x, y: point.y + y }));
        // ELK's compound ports can introduce half-pixel slants at hierarchy boundaries.
        points.slice(1).forEach((point, index) => {
          const previous = points[index];
          if (Math.abs(point.x - previous.x) < 1) point.x = previous.x;
          else if (Math.abs(point.y - previous.y) < 1) point.y = previous.y;
        });
        return points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
      }), labels: (edge.labels ?? []).map(label => ({ id: label.id!, x: (label.x ?? 0) + x, y: (label.y ?? 0) + y, width: label.width ?? 0, height: label.height ?? 0, lines: metadata.labelLines.get(label.id!) ?? [label.text ?? ""] })) });
    }
    for (const child of parent.children ?? []) {
      const box = { id: metadata.originalIds.get(child.id) ?? child.id, x: (child.x ?? 0) + x, y: (child.y ?? 0) + y, width: child.width ?? 144, height: child.height ?? 58 };
      if (metadata.groupNames.has(child.id)) groups.push({ ...box, title: metadata.groupNames.get(child.id)! }); else nodes.push(box);
      visit(child, box.x, box.y);
    }
  };
  visit(graph, 0, 0);
  let width = graph.width ?? 0, height = graph.height ?? 0;
  const occupied = links.flatMap(link => link.paths.flatMap(path => routeSegments([...path.matchAll(/[ML]([\d.-]+),([\d.-]+)/gu)].map(match => ({ x: Number(match[1]), y: Number(match[2]) })))));
  for (const [index, edge] of [...metadata.feedback, ...metadata.comparisons].entries()) {
    const from = nodes.find(node => node.id === edge.from)!, to = nodes.find(node => node.id === edge.to)!;
    const horizontal = metadata.direction === "RIGHT";
    const siblings = [...metadata.feedback, ...metadata.comparisons];
    const endpoint = (node: DiagramBox, end: "source" | "target", side: number) => {
      const incident = siblings.flatMap(item => [
        ...(item.from === node.id ? [{ edge: item, end: "source" }] : []),
        ...(item.to === node.id ? [{ edge: item, end: "target" }] : []),
      ]);
      const offset = (incident.findIndex(item => item.edge === edge && item.end === end) + 1) / (incident.length + 1);
      return horizontal ? { x: node.x + node.width * offset, y: node.y + (side > 0 ? node.height : 0) } : { x: node.x + (side > 0 ? node.width : 0), y: node.y + node.height * offset };
    };
    const obstacles = [...nodes, ...links.flatMap(link => link.labels)];
    const lane = 24 + index * 20;
    const bounds = { width: (graph.width ?? 0) + lane + 24, height: (graph.height ?? 0) + lane + 24 };
    // Consider both outer sides. A return from a left-hand branch should not
    // weave through the forward fan-out merely to reach a fixed right lane.
    const candidates = (horizontal ? [-1, 1] : [1, -1]).flatMap(side => {
      const start = endpoint(from, "source", side), end = endpoint(to, "target", side);
      const outside = (point: typeof start) => horizontal ? { x: point.x, y: point.y + side * 18 } : { x: point.x + side * 18, y: point.y };
      const track = side < 0 ? -lane : (horizontal ? graph.height ?? 0 : graph.width ?? 0) + lane;
      const laneStart = horizontal ? { x: start.x, y: track } : { x: track, y: start.y };
      const laneEnd = horizontal ? { x: end.x, y: track } : { x: track, y: end.y };
      const first = routeDiagram(outside(start), laneStart, obstacles, bounds, [laneStart], occupied);
      const last = routeDiagram(laneEnd, outside(end), obstacles, bounds, [laneEnd], occupied);
      if (!first.length || !last.length) return [];
      const points = [start, ...first, laneEnd, ...last.slice(1), end];
      return [{ points, score: routeCost(points, occupied) }];
    });
    const points = candidates.sort((a, b) => a.score - b.score)[0]?.points ?? [];
    // Never draw a straight line through a concept when no clear route exists.
    const paths = points.length ? [points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ")] : [];
    const text = metadata.compactLabels ? edge.label ?? "" : understandingRelationText(edge, metadata.zh, false);
    const lines = diagramTextLines(text, 14);
    const label = metadata.labels && text && points.length ? diagramLabelPosition(points, Math.max(48, ...lines.map(line => textWidth(line, 14) + 22)), lines.length * 20 + 10, obstacles, `${connectorKey(edge)}:label`) : undefined;
    links.push({ id: connectorKey(edge), paths, labels: label ? [{ ...label, lines }] : [] });
    occupied.push(...routeSegments(points));
  }
  // Include exterior routes and optional labels in the SVG bounds.
  const extents = links.flatMap(link => [
    ...link.labels,
    ...link.paths.flatMap(path => [...path.matchAll(/[ML]([\d.-]+),([\d.-]+)/gu)].map(match => ({ x: Number(match[1]), y: Number(match[2]), width: 0, height: 0 }))),
  ]);
  const left = Math.max(0, ...extents.map(box => 16 - box.x));
  const top = Math.max(0, ...extents.map(box => 16 - box.y));
  width = Math.max(width, ...extents.map(box => box.x + box.width + 16)) + left;
  height = Math.max(height, ...extents.map(box => box.y + box.height + 16)) + top;
  if (left || top) {
    [...nodes, ...groups].forEach(node => { node.x += left; node.y += top; });
    links.forEach(link => { link.paths = link.paths.map(path => path.replace(/([ML])([\d.-]+),([\d.-]+)/gu, (_, command: string, x: string, y: string) => `${command}${Number(x) + left},${Number(y) + top}`)); link.labels.forEach(label => { label.x += left; label.y += top; }); });
  }
  return { width, height, nodes, groups, links };
}

let engine: Promise<import("elkjs/lib/elk-api").ELK> | undefined;
const cache = new Map<string, Promise<DiagramLayout>>();
/** Lazy local layout: never sends project content to a service or calls a model. */
export function layoutDiagram(input: DiagramInput, refresh=false): Promise<DiagramLayout> {
  const metadata = createDiagramGraph(input), key = JSON.stringify([input.simple, metadata.graph, metadata.comparisons, metadata.feedback, metadata.direction, metadata.labels, [...metadata.originalIds], [...metadata.groupNames], [...metadata.labelLines], [...metadata.edgeKeys]]);
  const existing = cache.get(key); if (existing && !refresh) return existing;
  engine ??= import("elkjs/lib/elk.bundled.js").then(({ default: ELK }) => new ELK());
  const standard = (elk: import("elkjs/lib/elk-api").ELK) => elk.layout(metadata.graph).then(graph => flattenDiagram(graph, metadata));
  const job = engine.then(standard).catch(error => { cache.delete(key); throw error; });
  if (cache.size >= 16) cache.delete(cache.keys().next().value!);
  cache.set(key, job);
  return job;
}

import type { FocusSection } from "../shared/focus-session";
import type { UnderstandingEdge } from "./understanding-model";

export type UnderstandingPresentationKind = "diagram" | "process" | "hierarchy" | "modules" | "comparison" | "timeline" | "decision" | "points";
export const isUnderstandingDiagram = (kind: UnderstandingPresentationKind) => ["diagram", "process", "hierarchy"].includes(kind);

/** A literal named arrow path is a concrete transfer even without an optional edge label. */
function explicitArrowFlow(edge: UnderstandingEdge, points: FocusSection[]) {
  if (edge.kind !== "flow") return false;
  const plain = (text: string) => text.normalize("NFKC").replace(/[*`_]/gu, "").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
  const from = points.find(point => point.id === edge.from), to = points.find(point => point.id === edge.to);
  if (!from || !to || !plain(from.title) || !plain(to.title)) return false;
  const quote = plain(edge.excerpt), start = quote.indexOf(plain(from.title)), end = quote.indexOf(plain(to.title), start + plain(from.title).length);
  return start >= 0 && end > start && /^[\s)\]）:：]*(?:->|=>|→|⇒|⟶|➜)[\s[(（]*$/u.test(quote.slice(start + plain(from.title).length, end));
}

/** A graph must explain more than a pair of headings. Personal connections remain available. */
export function hasUsefulUnderstandingDiagram(points: FocusSection[], edges: UnderstandingEdge[]): boolean {
  const ids = new Set(points.map(point => point.id));
  const links = edges.filter(edge => !edge.uncertain && ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);
  if (links.some(edge => edge.authored)) return true;
  const explained = links.filter(edge => edge.excerpt.trim() && (
    Boolean(edge.label?.trim() && !/^(?:包含|组成|关联|相关|传递|依赖|前提|反馈|contains|flow|requires|related|feedback)$/iu.test(edge.label.trim())) ||
    // Legacy local extraction retains a concrete source sentence, but has no label.
    /输出给|输出至|传递给|传递至|交给|提交给|发送给|输入到|依赖|基于|需要先|反馈给|反馈至|返回给|outputs? to|passes? to|depends on|based on|requires|feeds? back to/iu.test(edge.excerpt) || explicitArrowFlow(edge, points)
  ));
  if (explained.some(edge => ["flow", "requires", "feedback"].includes(edge.kind))) return true;
  return explained.length >= 2 && new Set(explained.flatMap(edge => [edge.from, edge.to])).size >= 3;
}

/** A sequence needs one unambiguous, source-backed path, not the saved reading order. */
export function understandingSequence(points: FocusSection[], edges: UnderstandingEdge[]): FocusSection[] | undefined {
  const ids = new Set(points.map(point => point.id));
  const links = edges.filter(edge => !edge.uncertain && ["flow", "requires"].includes(edge.kind) && ids.has(edge.from) && ids.has(edge.to));
  const pairs = [...new Map(links.map(edge => [`${edge.from}\0${edge.to}`, edge])).values()];
  if (points.length < 2 || pairs.length !== points.length - 1) return;
  if (points.some(point => pairs.filter(edge => edge.from === point.id).length > 1 || pairs.filter(edge => edge.to === point.id).length > 1)) return;
  const first = points.filter(point => !pairs.some(edge => edge.to === point.id));
  if (first.length !== 1) return;
  const ordered = [first[0]], seen = new Set([first[0].id]);
  while (ordered.length < points.length) {
    const next = pairs.find(edge => edge.from === ordered.at(-1)!.id)?.to;
    if (!next || seen.has(next)) return;
    seen.add(next); ordered.push(points.find(point => point.id === next)!);
  }
  return ordered;
}

export const hasVersionHeading = (point: FocusSection) => /(?:\bv\d+(?:\.\d+)*\b|\bM\d+(?:\.\d+)*\b|Milestone\s*\d+|\d{4}[-/年]\d{1,2})/iu.test(point.title);

/** Use relationships as evidence for a diagram, never reading order or neighbouring cards. */
export function diagramConceptIds(points: FocusSection[], edges: UnderstandingEdge[]): Set<string> {
  const ids = new Set(points.map(point => point.id));
  return new Set(edges.filter(edge => !edge.uncertain && ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to).flatMap(edge => [edge.from, edge.to]));
}

/** Preserve a real Markdown table verbatim; code examples are not comparison tables. */
export function comparisonTable(body = ""): string | undefined {
  const lines = body.split("\n");
  let fence = "";
  for (let i = 0; i < lines.length - 2; i++) {
    const marker = lines[i].trim().match(/^(`{3,}|~{3,})/u)?.[1];
    if (marker) { if (!fence) fence = marker[0]; else if (fence === marker[0]) fence = ""; continue; }
    if (fence || !lines[i].includes("|")) continue;
    const cells = lines[i + 1].trim().replace(/^\||\|$/gu, "").split("|");
    if (cells.length < 2 || !cells.every(cell => /^\s*:?-{3,}:?\s*$/u.test(cell))) continue;
    let end = i + 2;
    while (end < lines.length && lines[end].includes("|") && lines[end].trim()) end++;
    if (end > i + 2) return lines.slice(i, end).join("\n");
  }
}

export function understandingPresentation(points: FocusSection[], edges: UnderstandingEdge[], title = "", body = ""): UnderstandingPresentationKind {
  if (/比较|对比|选型|选择|方案|comparison|compar(?:e|ing)|choice/iu.test(title) && comparisonTable(body)) return "comparison";
  // Only actual version headings qualify. Source/import dates never become product releases.
  if (/版本|变迁|演进|里程碑|历史|version|evolution|history|milestone/iu.test(title) && points.filter(hasVersionHeading).length >= 2) return "timeline";
  if (edges.some(edge => edge.authored && !edge.uncertain && points.some(point => point.id === edge.from) && points.some(point => point.id === edge.to))) return "diagram";
  const connected = diagramConceptIds(points, edges);
  const linked = points.filter(point => connected.has(point.id));
  const links = edges.filter(edge => !edge.uncertain && connected.has(edge.from) && connected.has(edge.to));
  // A supported local relation remains useful even amid many unrelated facts.
  // Containment is a hierarchy, not a causal flow; isolated points remain separate.
  if (linked.length >= 2) {
    if (links.every(edge => edge.kind === "contains" || edge.kind === "example")) return "hierarchy";
    if (links.every(edge => edge.kind === "flow" || edge.kind === "requires") && understandingSequence(linked, links)) return "process";
    return "diagram";
  }
  if (points.some(point => point.inputs?.length || point.outputs?.length)) return "modules";
  if (/决策|约束|边界|策略|decision|constraint|boundar|strategy/iu.test(title)) return "decision";
  return "points";
}

import type { FocusSection, UnderstandingRelationKind } from "../shared/focus-session";
import { understandingRelationKinds } from "../shared/understanding-relations";
export { understandingRelationKinds, understandingEdgeLabel } from "../shared/understanding-relations";
import { evidencePresentation } from "./evidence-presentation";
import { reviewLead } from "./review-presentation";

export type UnderstandingRole = "premise" | "example" | "comparison" | "correction" | "conclusion";
export const understandingLabels: Record<UnderstandingRole, [string, string]> = {
  premise: ["前提", "Premise"], example: ["例子", "Example"], comparison: ["比较", "Comparison"],
  correction: ["修正", "Correction"], conclusion: ["结论", "Conclusion"],
};

/** Labels describe explicit text, never an invented relationship between neighbours. */
export function understandingRole(step: FocusSection): UnderstandingRole | undefined {
  const text = evidencePresentation(step.title);
  const rules: Array<[UnderstandingRole, RegExp]> = [
    ["correction", /修正|纠正|改进|转折|correction|revision/iu],
    ["comparison", /比较|对比|取舍|区别|comparison|versus|trade.?off/iu],
    ["example", /例子|示例|案例|example|case study/iu],
    ["premise", /前提|基础|先决条件|prerequisite|premise|assumption/iu],
    ["conclusion", /结论|总结|决定|conclusion|decision|summary/iu],
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0];
}

export interface UnderstandingEdge { from: string; to: string; kind: UnderstandingRelationKind; excerpt: string; label?: string; authored?: true; uncertain?: true; evidenceIds?: string[] }

/** Prefer the quoted payload/action over a relation enum. Full evidence remains below the map. */
export function understandingRelationText(edge: UnderstandingEdge, zh: boolean, compact = true): string {
  if (edge.label?.trim() && !/^(?:输出给|是前提|反馈至|contains|requires|flow|feedback)$/iu.test(edge.label.trim())) return !compact || [...edge.label.trim()].length <= 20 ? edge.label.trim() : `${[...edge.label.trim()].slice(0, 19).join("")}…`;
  const quote = evidencePresentation(edge.excerpt).replace(/[*_`]/gu, "").replace(/\s+/gu, " ").trim();
  if (edge.kind !== "contains" && quote) {
    if (!compact) return quote;
    const payload = quote.match(/(?:将|把)([^，。；]{2,24}?)(?:输出|传递|提交|反馈)(?:给|至|到)/u)?.[1];
    if (payload) return `${edge.kind === "feedback" ? "反馈" : "传递"}${payload}`;
    return [...quote].length <= 20 ? quote : `${[...quote].slice(0, 19).join("")}…`;
  }
  const labels: Record<UnderstandingRelationKind, [string, string]> = {
    contains: ["包含", "Contains"], requires: ["依赖条件", "Dependency"], flow: ["数据传递", "Data flow"],
    feedback: ["修正反馈", "Feedback"], example: ["具体示例", "Example"], comparison: ["方案对比", "Comparison"],
  };
  return labels[edge.kind][zh ? 0 : 1];
}
/** Only an explicitly labelled duty is a responsibility; a random opening sentence is not. */
export function understandingResponsibility(step: FocusSection): string {
  if (step.responsibility?.trim()) return step.responsibility.trim();
  if (step.origin || step.userEdited) return "";
  const text = evidencePresentation(step.body).replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/gu, "").replace(/[*_`]/gu, "");
  return text.split("\n").map(line => line.match(/^\s*(?:[-+]\s*)?(?:职责|作用|responsibility|purpose)\s*[:：]\s*(.+)$/iu)?.[1]?.trim()).find(Boolean) ?? "";
}
export function understandingEdges(steps: FocusSection[]): UnderstandingEdge[] {
  const edges: UnderstandingEdge[] = [];
  const derived = steps.filter(step => !step.origin && !step.userEdited && !step.semanticStructure && !["proposal", "open_question"].includes(step.kind));
  const titles = new Map<string, FocusSection[]>();
  derived.forEach(step => { const title = evidencePresentation(step.title).replace(/[*_`]/gu, "").trim(); titles.set(title, [...(titles.get(title) ?? []), step]); });
  for (const step of derived) {
    // Heading hierarchy is containment, not evidence of causal dependency.
    const parents = derived.filter(candidate => candidate.id !== step.id && candidate.title === step.phase);
    if (parents.length === 1) edges.push({ from: parents[0].id, to: step.id, kind: "contains", excerpt: step.phase! });
    const text = evidencePresentation(step.body).replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/gu, "").replace(/^\s*>.*$/gmu, "").replace(/[*_`]/gu, "");
    const searchText = text.toLowerCase();
    for (const [title, candidates] of titles) {
      const candidate = candidates[0];
      if (candidate.id === step.id || title.length < 2 || title.length > 60 || candidates.length !== 1) continue;
      // Large project structures contain many headings; avoid constructing regexes for absent names.
      if (!searchText.includes(title.toLowerCase())) continue;
      const escaped = title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const explicit = new RegExp(`(?:基于|依赖(?:于)?|需要先(?:理解|掌握|了解)|based on|depends on|requires)\\s*[“"'「]?${escaped}(?:[”"'」]?)(?=[，。；,:;.!?\\s]|作为|为|$)`, "iu");
      const sentence = text.split(/(?<=[。！？.!?])\s*/u).find(item => explicit.test(item)
        && !/[?？]|是否|假设|如果|if\s|whether|suppose/iu.test(item)
        && !/(?:不|无需|并非|不是|不必|not|without|avoid)[^。！？.!?]{0,12}(?:需要|依赖|基于|depend|require|based on)/iu.test(item));
      if (sentence) edges.push({ from: candidate.id, to: step.id, kind: "requires", excerpt: sentence.trim() });
      const relationSentence = text.split(/(?<=[。！？.!?])\s*/u).filter(item => !/[?？]|是否|假设|如果|if\s|whether|suppose/iu.test(item));
      for (const [kind, pattern] of [
        ["example", new RegExp(`(?:以\\s*[“"'「]?${escaped}[”"'」]?\\s*为例|example of\\s+${escaped}(?=[\\s,.!;]|$))`, "iu")],
        ["comparison", new RegExp(`(?:与\\s*[“"'「]?${escaped}[”"'」]?\\s*(?:相比|比较)|compared (?:with|to)\\s+${escaped}(?=[\\s,.!;]|$))`, "iu")],
      ] as const) {
        const excerpt = relationSentence.find(item => pattern.test(item) && !/(?:不|并非|不是|not|without)[^。！？.!?]{0,12}(?:以|与|example|compared)/iu.test(item));
        if (excerpt) edges.push({ from: candidate.id, to: step.id, kind, excerpt: excerpt.trim() });
      }
      // Direction comes from the explicit verb, not position in the reading route.
      const end = `(?=[，。；,:;.!?\\s]|$)`;
      const output = new RegExp(`^(?:${step.title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*)?(?:将[^。！？.!?]{1,60}?\\s*)?(?:输出给|输出至|传递给|传递至|outputs? to|passes? to)\\s*[“"'「]?${escaped}[”"'」]?${end}`, "iu");
      const feedback = new RegExp(`^(?:${step.title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*)?(?:将[^。！？.!?]{1,60}?\\s*)?(?:反馈给|反馈至|返回给|feeds? back to)\\s*[“"'「]?${escaped}[”"'」]?${end}`, "iu");
      for (const [kind, pattern] of [["flow", output], ["feedback", feedback]] as const) {
        const excerpt = relationSentence.find(item => pattern.test(item.trim()) && !/(?:不|无需|并非|不是|不必|not|without)[^。！？.!?]{0,12}(?:输出|传递|反馈|返回|output|pass|feed)/iu.test(item));
        if (excerpt) edges.push({ from: step.id, to: candidate.id, kind, excerpt: excerpt.trim() });
      }
    }
  }
  const authored = steps.flatMap(step => (step.understandingLinks ?? []).filter(link => understandingRelationKinds.includes(link.kind) && link.targetId !== step.id && steps.some(target => target.id === link.targetId)).map(link => ({ from: step.id, to: link.targetId, kind: link.kind, excerpt: "", authored: true as const })));
  const semanticTargets = new Map(steps.flatMap(step => (step.semanticStructure?.nodes ?? []).map(node => [node.key, step.id] as const)));
  for (const step of steps.filter(step => !step.origin && !step.userEdited)) for (const relation of step.semanticStructure?.relations ?? []) {
    const from = semanticTargets.get(relation.from), to = semanticTargets.get(relation.to);
    if (from && to && from !== to) edges.push({ from, to, kind: relation.kind, label: relation.label, excerpt: relation.quote, evidenceIds: relation.evidenceIds, ...(relation.status === "uncertain" ? { uncertain: true } : {}) });
  }
  const overridden = new Set(authored.map(edge => JSON.stringify([edge.from, edge.to])));
  return [...new Map([...edges.filter(edge => !overridden.has(JSON.stringify([edge.from, edge.to]))), ...authored].map(edge => [JSON.stringify([edge.from, edge.to, edge.kind]), edge])).values()];
}

/** Layout only: labels and excerpts carry meaning; spatial order never adds a relation. */
export function understandingColumns(steps: FocusSection[], edges: UnderstandingEdge[]): FocusSection[][] {
  edges = edges.filter(edge => edge.kind !== "comparison" && edge.kind !== "feedback");
  const incoming = new Map(steps.map(step => [step.id, new Set(edges.filter(edge => edge.to === step.id).map(edge => edge.from)).size]));
  const rank = new Map(steps.map(step => [step.id, 0]));
  const outgoing = new Map(steps.map(step => [step.id, [...new Set(edges.filter(edge => edge.from === step.id).map(edge => edge.to))]]));
  const queue = steps.filter(step => !incoming.get(step.id)).map(step => step.id);
  for (let index = 0; index < queue.length; index++) {
    for (const id of outgoing.get(queue[index]) ?? []) {
      rank.set(id, Math.min(3, Math.max(rank.get(id) ?? 0, (rank.get(queue[index]) ?? 0) + 1)));
      incoming.set(id, (incoming.get(id) ?? 0) - 1);
      if (!incoming.get(id)) queue.push(id);
    }
  }
  // Cyclic references remain visible together, without fabricating an ordering.
  const visited = new Set(queue);
  steps.filter(step => !visited.has(step.id)).forEach(step => rank.set(step.id, 0));
  return Array.from({ length: Math.max(0, ...rank.values()) + 1 }, (_, column) => steps.filter(step => rank.get(step.id) === column)).filter(column => column.length);
}

/** Extract existing tables intact; fenced code is never interpreted as a table. */
export function understandingTables(steps: FocusSection[]) {
  return steps.flatMap(step => {
    const lines = step.body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/gu, "").split("\n");
    const tables: Array<{ stepId: string; title: string; markdown: string }> = [];
    for (let index = 1; index < lines.length; index++) {
      if (!/^\s*\|?\s*:?-{3,}:?\s*\|(?:\s*:?-{3,}:?\s*\|?)+\s*$/u.test(lines[index]) || !lines[index - 1].includes("|")) continue;
      const start = index - 1;
      while (index + 1 < lines.length && lines[index + 1].includes("|") && lines[index + 1].trim()) index++;
      tables.push({ stepId: step.id, title: step.title, markdown: lines.slice(start, index + 1).join("\n") });
    }
    return tables;
  });
}

export function understandingLead(step: FocusSection) {
  const text = reviewLead(step.body);
  return text && text !== step.title && text.length <= 220 ? text : "";
}

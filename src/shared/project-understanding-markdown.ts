import type { FocusSession } from "./focus-session";
import { understandingRelationLabels } from "./understanding-relations";
import { mergeSemanticStructures, semanticId } from "./semantic-structure";
import { structureIsCurrent } from "./structure-signature";

/** Structured AI interpretation remains labelled as analysis, not confirmed user decisions. */
export function analyzedProjectMarkdown(session: FocusSession, zh: boolean, sectionId?: string): string {
  const sections = session.sections.filter(section => (!sectionId || section.id === sectionId) && structureIsCurrent(section, session));
  if (!sections.length) return "";
  const ids = new Set(sections.map(section => section.id));
  const validOverview = !sectionId && session.semanticOverview?.nodes.every(node => node.sectionIds?.every(id => ids.has(id)));
  const graph = validOverview ? session.semanticOverview! : mergeSemanticStructures(sections.map(section => ({ nodes: section.semanticStructure!.nodes.map(node => ({ ...node, sectionIds: [section.id] })), relations: section.semanticStructure!.relations })));
  const edited = new Set(session.projectUnderstanding?.nodes.map(node => node.id));
  const nodes = graph.nodes.filter(node => !edited.has(semanticId(node.key)));
  if (!nodes.length) return "";
  const names = new Map(graph.nodes.map(node => [node.key, session.projectUnderstanding?.nodes.find(edit => edit.id === semanticId(node.key))?.title ?? node.title]));
  const status = { discussed: zh ? "历史讨论" : "Historical discussion", proposal: zh ? "历史建议" : "Historical proposal", uncertain: zh ? "待确认" : "Uncertain", superseded: zh ? "已修正" : "Superseded" };
  return [`## ${zh ? "结构（AI 分析）" : "Structure (AI analysis)"}`, ...nodes.map(node => [
    `### ${node.title.replace(/\s+/gu, " ")} · ${status[node.status]}`, node.description,
    `${zh ? "关联章节" : "Chapters"}：${sections.filter(section => node.sectionIds?.includes(section.id)).map(section => section.title.replace(/\s+/gu, " ")).join(" · ")}`,
    ...graph.relations.filter(edge => edge.from === node.key && names.has(edge.to)).map(edge => `- ${understandingRelationLabels[edge.kind][zh ? 0 : 1]} → ${names.get(edge.to)}${edge.status === "uncertain" ? zh ? "（待确认）" : " (uncertain)" : ""}`),
  ].join("\n\n"))].join("\n\n");
}

/** Export authored structure as personal understanding, never as an original source claim. */
export function personalProjectMarkdown(session: FocusSession, zh: boolean, sectionId?: string): string {
  const label = (cn: string, en: string) => zh ? cn : en;
  const line = (text: string) => text.replace(/\s+/gu, " ").trim();
  const nodes = (session.projectUnderstanding?.nodes ?? []).filter(node => !sectionId || node.sectionIds.includes(sectionId));
  if (!nodes.length) return "";
  const titles = new Map((session.projectUnderstanding?.nodes ?? []).map(node => [node.id, node.title]));
  return [`## ${label("我的项目结构", "My project structure")}`, ...nodes.map(node => {
    const chapters = session.sections.filter(section => node.sectionIds.includes(section.id));
    return [`### ${line(node.title)}`, !session.detachedNotes?.some(note => note.understandingNoteId === `project:${node.id}`) ? (node.personalExplanation || node.responsibility).trim() : "",
      chapters.length ? `${label("关联章节", "Related chapters")}：${chapters.map(section => line(section.title)).join(" · ")}` : "",
      ...node.links.flatMap(link => {
        // A generated target's display name is recorded when the user saves the relation.
        const name = titles.get(link.targetId) || link.targetTitle;
        return name && understandingRelationLabels[link.kind] ? [`- ${label("我的关系", "My relation")}：${line(node.title)} → ${understandingRelationLabels[link.kind][zh ? 0 : 1]} → ${line(name)}`] : [];
      }),
    ].filter(Boolean).join("\n\n");
  })].join("\n\n");
}

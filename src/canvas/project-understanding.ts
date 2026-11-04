import type { FocusSection, FocusSession, ProjectUnderstandingEdit, ProjectUnderstandingEdits } from "../shared/focus-session";
import { chapterSteps } from "./chapter-understanding";
import { evidencePresentation } from "./evidence-presentation";
import { understandingEdges, understandingResponsibility, type UnderstandingEdge } from "./understanding-model";
import { mergeSemanticStructures, semanticId } from "../shared/semantic-structure";
import { structureIsCurrent, type StructureSources } from "../shared/structure-signature";
import { projectStateModel } from "../shared/project-state";
import { removePersonalRouteCard } from "./focus-route";

export interface ProjectConcept extends FocusSection { sectionIds: string[]; personalCard?: { sectionId: string; cardId: string }; semanticStatus?: string; semanticBasis?: string; inputs?: string[]; outputs?: string[]; layer?: string }
const key = (text: string) => evidencePresentation(text).normalize("NFKC").replace(/[*_`]/gu, "").replace(/\s+/gu, " ").trim().toLowerCase();
const generic = /^(?:概况|基础|目标|约束|总结|结论|关键经验|证据引用|实际应用|后续计划|前提|例子|对比|修正|overview|basics|goals|constraints|summary|conclusion|example|references|next steps)$/iu;

/** Reuse named concepts, hierarchy and explicit relations. Paragraphs are not renamed as modules. */
export function projectUnderstandingModel(session: Pick<FocusSession, "sections" | "projectUnderstanding" | "semanticOverview"> & Partial<Pick<FocusSession, "projectState" | "projectMaintenance" | "mode">> & StructureSources, complete = false) {
  const nodes = new Map<string, ProjectConcept>();
  const mapped = new Map<string, string>();
  const raw: FocusSection[] = [];
  const localEdges: UnderstandingEdge[] = [];
  const savedPhases = new Map<string, Set<string>>();
  const rememberPhase = (id: string, phase?: string) => {
    if (!phase?.trim()) return;
    const names = savedPhases.get(id) ?? new Set<string>();
    names.add(phase.trim()); savedPhases.set(id, names);
  };
  const eligible = session.sections.filter(section => structureIsCurrent(section, session));
  const covered = new Set(eligible.map(section => section.id));
  const overviewValid = session.semanticOverview?.nodes.every(node => node.sectionIds?.length && node.sectionIds.every(id => covered.has(id)));
  const represented = new Set(overviewValid ? session.semanticOverview!.nodes.flatMap(node => node.sectionIds ?? []) : []);
  const semantic = mergeSemanticStructures([
    ...(overviewValid ? [session.semanticOverview!] : []),
    ...eligible.filter(section => !represented.has(section.id)).map(section => ({ nodes: section.semanticStructure!.nodes.map(node => ({ ...node, sectionIds: [section.id] })), relations: section.semanticStructure!.relations })),
  ]);
  for (const node of semantic.nodes) {
    const id = semanticId(node.key);
    nodes.set(id, { id, title: node.title, body: node.quote, responsibility: node.description, layer: node.layer, inputs: node.inputs, outputs: node.outputs, transition: "", kind: node.status === "proposal" ? "proposal" : node.status === "uncertain" || node.status === "superseded" ? "open_question" : "review", evidenceIds: node.evidenceIds, sectionIds: node.sectionIds ?? [], semanticStatus: node.status, semanticBasis: node.basis });
    for (const sectionId of node.sectionIds ?? []) rememberPhase(id, session.sections.find(section => section.id === sectionId)?.phase);
  }
  for (const edge of semantic.relations) {
    const from = semanticId(edge.from), to = semanticId(edge.to);
    if (nodes.has(from) && nodes.has(to)) localEdges.push({ from, to, kind: edge.kind, label: edge.label, excerpt: edge.quote, evidenceIds: edge.evidenceIds, ...(edge.status === "uncertain" ? { uncertain: true } : {}) });
  }
  const add = (id: string, title: string, section: FocusSection, source?: FocusSection) => {
    const old = nodes.get(id);
    const responsibility = source ? understandingResponsibility(source) : "";
    const next: ProjectConcept = old ?? { id, title, body: source?.body ?? "", transition: "", kind: source?.kind ?? section.kind, evidenceIds: [], sectionIds: [], responsibility };
    if (!next.responsibility && responsibility) next.responsibility = responsibility;
    next.sectionIds = [...new Set([...next.sectionIds, section.id])];
    next.evidenceIds = [...new Set([...next.evidenceIds, ...(source?.evidenceIds ?? section.evidenceIds)])];
    if (source?.origin || source?.userEdited || source?.structureEdited) next.userEdited = true;
    if (source?.origin === "user" && source.id !== section.id) next.personalCard = { sectionId: section.id, cardId: source.id };
    rememberPhase(id, source?.phase || section.phase);
    nodes.set(id, next);
  };
  for (const section of session.sections) {
    const steps = chapterSteps(section, session);
    for (const step of steps) {
      const semanticKey = step.semanticStructure?.nodes[0]?.key;
      const node = semanticKey ? nodes.get(semanticId(semanticKey)) : undefined;
      if (node && !node.body.trim() && step.body.trim()) node.body = step.body;
    }
    const named = steps.filter(step => step.origin || step.userEdited || !/:(?:body(?:-|$))/u.test(step.id));
    const hasChapterStructure = section.understandingLinks?.length || section.responsibility?.trim();
    const concepts = covered.has(section.id) ? steps.filter(step => step.origin || step.userEdited || step.structureEdited) : named.length ? hasChapterStructure ? [section, ...named] : named : [section];
    const groupId = !covered.has(section.id) && section.phase?.trim() ? `project-group:${key(section.phase)}` : undefined;
    if (groupId) add(groupId, section.phase!.trim(), section);
    for (const concept of concepts) {
      const title = concept.origin || concept.userEdited ? concept.title.trim() : evidencePresentation(concept.title).replace(/[*_`]/gu, "").trim();
      // Generic labels and personal cards need a scope; unrelated "Conclusion" nodes must not merge.
      const scope = concept.origin || concept.userEdited ? section.id : generic.test(title) ? key(section.title) : key(concept.phase || section.phase || "");
      const id = `project-concept:${JSON.stringify([scope, key(title)])}`;
      add(id, title, section, concept);
      const rawId = JSON.stringify([section.id, concept.id]);
      mapped.set(rawId, id);
      raw.push({ ...concept, id: rawId, understandingLinks: concept.understandingLinks?.map(link => ({ ...link, targetId: JSON.stringify([section.id, link.targetId]) })) });
      if (groupId && !concept.phase) localEdges.push({ from: groupId, to: id, kind: "contains", excerpt: section.phase!, ...(section.origin || section.userEdited ? { authored: true as const } : {}) });
    }
    // Preserve local relations before merging identical concepts across chapters.
    const map = new Map(concepts.map(concept => [concept.id, mapped.get(JSON.stringify([section.id, concept.id]))!]));
    for (const edge of understandingEdges(steps)) {
      const from = map.get(edge.from), to = map.get(edge.to);
      if (from && to && from !== to) localEdges.push({ ...edge, from, to });
    }
    if (concepts.includes(section)) mapped.set(section.id, map.get(section.id)!);
  }
  const edges = [...localEdges];
  for (const edge of [...understandingEdges(raw), ...understandingEdges(session.sections)]) {
    const from = mapped.get(edge.from), to = mapped.get(edge.to);
    if (from && to && from !== to) edges.push({ ...edge, from, to });
  }
  if ((complete || session.mode === "work") && session.projectState) {
    const plan = projectStateModel(session as FocusSession)!;
    const ids = new Map<string, string>();
    for (const module of plan.modules.filter(item => item.status !== "superseded")) {
      const matching = [...nodes.values()].filter(node => key(node.title) === key(module.title) && !node.userEdited && node.semanticStatus !== "superseded");
      const id = matching.length === 1 ? matching[0].id : `project-module:${module.id}`;
      const previous = nodes.get(id);
      ids.set(module.id, id);
      const sectionIds = [...new Set([...(previous?.sectionIds ?? []), ...session.sections.filter(section => section.evidenceIds.some(ref => module.evidenceIds.includes(ref))).map(section => section.id)])];
      nodes.set(id, { ...(previous ?? { id, transition: "", kind: "review" as const }),
        title: module.title, body: module.quote, responsibility: module.purpose, inputs: module.inputs, outputs: module.outputs, layer: module.layer,
        evidenceIds: module.evidenceIds, sectionIds, semanticStatus: module.status === "documented" ? "discussed" : module.status,
        kind: module.status === "proposal" ? "proposal" : module.status === "uncertain" ? "open_question" : "review",
      });
    }
    for (const relation of plan.relations) {
      const from = ids.get(relation.from), to = ids.get(relation.to);
      if (!from || !to || from === to) continue;
      // The organized plan supplies explicit endpoints and a quoted relationship; no neighbour inference.
      const kind = relation.kind === "flow" && /反馈|回流|feed.?back/iu.test(relation.label) && /反馈|回流|feed.?back/iu.test(relation.quote) ? "feedback" : relation.kind;
      const uncertain = plan.modules.some(module => [relation.from, relation.to].includes(module.id) && module.status === "uncertain");
      edges.push({ from, to, kind, excerpt: relation.quote, label: relation.label, evidenceIds: relation.evidenceIds, ...(uncertain ? { uncertain: true as const } : {}) });
    }
  }
  for (const edit of session.projectUnderstanding?.nodes ?? []) {
    const previous = nodes.get(edit.id);
    // Keep personal wording even if its old material has disappeared; never attach guessed sources.
    const sectionIds = edit.sectionIds.filter(id => session.sections.some(section => section.id === id));
    nodes.set(edit.id, { ...(previous ?? { id: edit.id, body: "", transition: "", kind: "review" as const }), title: edit.title, responsibility: edit.responsibility, personalExplanation: edit.personalExplanation,
      sectionIds, evidenceIds: [...new Set(session.sections.filter(section => sectionIds.includes(section.id)).flatMap(section => section.evidenceIds))], userEdited: true, understandingLinks: edit.links });
  }
  // Retain explicit legacy phase names without choosing one for concepts shared
  // across conflicting phases, or inventing roles from their edge positions.
  for (const [id, names] of savedPhases) {
    const node = nodes.get(id);
    if (node && !node.layer && names.size === 1) {
      const phase = [...names][0];
      if (key(node.title) !== key(phase)) node.phase = phase;
    }
  }
  const authored: UnderstandingEdge[] = [...nodes.values()].flatMap(node => (node.understandingLinks ?? []).filter(link => nodes.has(link.targetId) && link.targetId !== node.id).map(link => ({ from: node.id, to: link.targetId, kind: link.kind, excerpt: "", authored: true as const })));
  const override = new Set(authored.map(edge => JSON.stringify([edge.from, edge.to])));
  const relations = [...new Map([...edges.filter(edge => !override.has(JSON.stringify([edge.from, edge.to]))), ...authored].map(edge => [JSON.stringify([edge.from, edge.to, edge.kind]), edge])).values()];
  const order = session.projectUnderstanding?.order ?? [];
  const sorted = [...nodes.values()].sort((a, b) => (order.includes(a.id) ? order.indexOf(a.id) : order.length) - (order.includes(b.id) ? order.indexOf(b.id) : order.length));
  return { nodes: sorted, edges: relations };
}

export function saveProjectConcept(edits: ProjectUnderstandingEdits | undefined, node: ProjectUnderstandingEdit): ProjectUnderstandingEdits {
  return { order: edits?.order ?? [], nodes: [...(edits?.nodes ?? []).filter(item => item.id !== node.id), node] };
}

/** Deleting an authored concept must not erase the material underlying an edited generated concept. */
export function removePersonalProjectConcept(edits: ProjectUnderstandingEdits | undefined, id: string): ProjectUnderstandingEdits {
  if (!id.startsWith("personal-concept:") || !edits?.nodes.some(node => node.id === id)) throw new Error("Only personal concepts can be deleted");
  return { order: edits.order.filter(nodeId => nodeId !== id), nodes: edits.nodes.filter(node => node.id !== id).map(node => ({ ...node, links: node.links.filter(link => link.targetId !== id) })) };
}

/** The overview can also contain authored cards belonging to an individual chapter. */
export function removeProjectUnderstandingCard(session: FocusSession, id: string): FocusSession {
  if (id.startsWith("personal-concept:")) return { ...session, projectUnderstanding: removePersonalProjectConcept(session.projectUnderstanding, id) };
  const card = projectUnderstandingModel(session, true).nodes.find(node => node.id === id)?.personalCard;
  if (!card) throw new Error("Only personal cards can be deleted");
  return { ...session,
    sections: session.sections.map(section => section.id === card.sectionId ? { ...section, understandingPath: removePersonalRouteCard(chapterSteps(section, session), card.cardId) } : section),
    projectUnderstanding: session.projectUnderstanding ? { order: session.projectUnderstanding.order.filter(nodeId => nodeId !== id), nodes: session.projectUnderstanding.nodes.filter(node => node.id !== id).map(node => ({ ...node, links: node.links.filter(link => link.targetId !== id) })) } : undefined,
  };
}

/** Entity IDs remain stable; remap only uniquely matched chapters when a generation replaces IDs. */
export function carryProjectUnderstanding(previous: FocusSession, next: FocusSession): ProjectUnderstandingEdits | undefined {
  if (!previous.projectUnderstanding) return;
  const match = (id: string) => {
    if (next.sections.some(section => section.id === id)) return id;
    const old = previous.sections.find(section => section.id === id);
    const candidates = next.sections.filter(section => old && section.title.trim() === old.title.trim());
    return candidates.length === 1 ? candidates[0].id : undefined;
  };
  return { ...previous.projectUnderstanding, nodes: previous.projectUnderstanding.nodes.map(node => ({ ...node, sectionIds: [...new Set(node.sectionIds.flatMap(id => { const mapped = match(id); return mapped ? [mapped] : []; }))] })) };
}

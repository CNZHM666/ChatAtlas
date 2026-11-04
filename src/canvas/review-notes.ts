import type { FocusSession } from "../shared/focus-session";
import { carryPersonalStructure } from "./personal-structure";
import { carryProjectUnderstanding } from "./project-understanding";
import { carryWikiNavigation } from "../shared/wiki-navigation";

/** Revisions change section IDs. Attach only unambiguous matches; keep the rest recoverable. */
export function carryReviewNotes(previous: FocusSession, next: FocusSession, preserveIds = false): Pick<FocusSession, "sectionNotes" | "detachedNotes" | "notes" | "reviewNeeds"> & Partial<Pick<FocusSession, "sections" | "projectUnderstanding" | "projectMaintenance" | "projectState" | "wikiOrder" | "wikiGroups" | "wikiCollapsedGroups" | "sidecarConversationIds">> {
  const sectionNotes: NonNullable<FocusSession["sectionNotes"]> = {};
  const reviewNeeds: Record<string, string> = {};
  const detachedNotes = (previous.detachedNotes ?? []).map(note => ({ ...note }));
  const used = new Set<string>();
  const paths = new Map<string, NonNullable<FocusSession["sections"][number]["understandingPath"]>>();
  const nextEvidenceIds = new Map(next.evidence.map(item => [JSON.stringify([item.conversationId, item.messageId]), item.id]));
  const previousEvidence = new Map(previous.evidence.map(item => [item.id, item]));
  const remapPath = (path: NonNullable<FocusSession["sections"][number]["understandingPath"]>) => {
    const mapped = path.map(step => {
      const evidenceIds = [...new Set(step.evidenceIds.flatMap(id => { const source = previousEvidence.get(id), mappedId = source && nextEvidenceIds.get(JSON.stringify([source.conversationId, source.messageId])); return mappedId ? [mappedId] : []; }))];
      return evidenceIds.join("\0") === step.evidenceIds.join("\0") ? step : { ...step, evidenceIds };
    });
    return mapped.every((step, index) => step === path[index]) ? path : mapped;
  };
  const refs = (session: FocusSession, ids: string[]) => new Set(session.evidence.filter((item) => ids.includes(item.id)).map((item) => JSON.stringify([item.conversationId, item.messageId])));
  for (const old of previous.sections) {
    const note = previous.sectionNotes?.[old.id];
    const question = previous.reviewNeeds?.[old.id];
    const linkedNotes = detachedNotes.filter(item => item.section?.id === old.id);
    if (!note && !question && !old.understandingPath && !linkedNotes.length) continue;
    const exact = next.sections.filter((item) => (preserveIds ? item.id === old.id : item.title.trim() === old.title.trim()) && !used.has(item.id));
    const oldRefs = refs(previous, old.evidenceIds);
    const candidates = exact.length === 1 ? exact : next.sections.filter((item) => {
      const nextRefs = refs(next, item.evidenceIds);
      const shared = [...oldRefs].filter((id) => nextRefs.has(id)).length;
      return !used.has(item.id) && shared > 0 && shared / Math.max(oldRefs.size, nextRefs.size) >= .75;
    });
    if (candidates.length === 1) {
      const id = candidates[0].id; used.add(id);
      for (const linked of linkedNotes) {
        linked.section = { id, title: candidates[0].title };
        const prefix = `chapter:${old.id}:`;
        if (linked.understandingNoteId?.startsWith(prefix)) linked.understandingNoteId = `chapter:${id}:${linked.understandingNoteId.slice(prefix.length)}`;
      }
      if (note) sectionNotes[id] = { ...note, sources: note.sources ?? previous.evidence.filter((item) => note.evidenceIds.includes(item.id)) };
      if (question) reviewNeeds[id] = question;
      if (old.understandingPath) paths.set(id, remapPath(old.understandingPath));
    } else if (note || question || old.understandingPath) detachedNotes.push({ title: note?.title || old.title, module: note?.module, deletedAt: note?.deletedAt, text: [note?.text, question, old.understandingPath?.filter(step => !detachedNotes.some(saved => saved.understandingNoteId === `chapter:${old.id}:${step.id}`)).map((step, index) => `${index + 1}. ${step.title}\n${step.body}`).join("\n\n")].filter(Boolean).join("\n\n"), sources: note?.sources ?? previous.evidence.filter((item) => (note?.evidenceIds ?? old.evidenceIds).includes(item.id)) });
  }
  const structured = carryPersonalStructure(previous, next, preserveIds);
  const extra = structured.detached.filter(note => !detachedNotes.some(old => old.title === note.title && old.text === note.text));
  const sections = structured.sections.map(section => paths.has(section.id) ? { ...section, understandingPath: paths.get(section.id) } : section);
  const remapIds = (ids: string[]) => ids.flatMap(id => { const ref = previousEvidence.get(id); const mapped = ref && nextEvidenceIds.get(JSON.stringify([ref.conversationId, ref.messageId])); return mapped ? [mapped] : []; });
  const remap = <T extends { evidenceIds: string[] }>(item: T): T => ({ ...item, evidenceIds: remapIds(item.evidenceIds) });
  const wiki = previous.mode === "work" ? carryWikiNavigation(previous, { ...next, sections }) : undefined;
  const finalSections = wiki?.sections ?? sections;
  return { ...(previous.sidecarConversationIds?.length ? { sidecarConversationIds: previous.sidecarConversationIds.filter(id => !next.sourceConversationIds.includes(id)) } : {}), notes: previous.notes, sectionNotes, detachedNotes: [...detachedNotes, ...extra], reviewNeeds,
    ...(previous.projectMaintenance ? { projectMaintenance: { ...previous.projectMaintenance, modules: Object.fromEntries(Object.entries(previous.projectMaintenance.modules ?? {}).map(([id, item]) => [id, remap(item)])) } } : {}),
    ...(!next.projectState && previous.projectState ? { projectState: { ...previous.projectState, modules: previous.projectState.modules.map(remap), relations: previous.projectState.relations.map(remap), decisions: previous.projectState.decisions.map(remap), constraints: previous.projectState.constraints.map(remap), actions: previous.projectState.actions.map(remap), ...(previous.projectState.questions ? { questions: previous.projectState.questions.map(remap) } : {}), ...(previous.projectState.history ? { history: previous.projectState.history.map(item => ({ ...remap(item), beforeEvidenceIds: remapIds(item.beforeEvidenceIds) })) } : {}) } } : {}),
    ...(previous.projectUnderstanding ? { projectUnderstanding: carryProjectUnderstanding(previous, next) } : {}), ...(wiki?.wikiGroups ? { wikiGroups: wiki.wikiGroups } : {}), ...(wiki?.wikiOrder ? { wikiOrder: wiki.wikiOrder } : {}), ...(wiki?.wikiCollapsedGroups ? { wikiCollapsedGroups: wiki.wikiCollapsedGroups } : {}), ...(finalSections.some((section, index) => section !== next.sections[index]) ? { sections: finalSections } : {}) };
}

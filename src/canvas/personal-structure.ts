import type { FocusSection, FocusSession } from "../shared/focus-session";
import { understandingRelationLabels } from "../shared/understanding-relations";

/** Never attach an authored relation to an ambiguous replacement chapter. */
export function carryPersonalStructure(previous: FocusSession, next: FocusSession, preserveIds: boolean) {
  const refs = (session: FocusSession, section: FocusSection) => new Set(session.evidence.filter(ref => section.evidenceIds.includes(ref.id)).map(ref => JSON.stringify([ref.conversationId, ref.messageId])));
  const matches = new Map<string, string>();
  for (const old of previous.sections) {
    const exact = next.sections.filter(section => preserveIds ? section.id === old.id : section.title.trim() === old.title.trim());
    const oldRefs = refs(previous, old);
    const candidates = exact.length === 1 ? exact : next.sections.filter(section => {
      const newRefs = refs(next, section), overlap = [...oldRefs].filter(id => newRefs.has(id)).length;
      return overlap > 0 && overlap / Math.max(oldRefs.size, newRefs.size) >= .75;
    });
    if (candidates.length === 1) matches.set(old.id, candidates[0].id);
  }
  const counts = new Map<string, number>();
  matches.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1));
  matches.forEach((id, oldId) => { if (counts.get(id)! > 1) matches.delete(oldId); });
  const patches = new Map<string, Partial<FocusSection>>();
  const detached: NonNullable<FocusSession["detachedNotes"]> = [];
  const zh = previous.locale !== "en";
  const describe = (old: FocusSection, links = old.understandingLinks ?? [], duty = old.responsibility) => [
    duty ? `${zh ? "我的说明" : "My explanation"}: ${duty}` : "",
    ...links.flatMap(link => {
      const target = previous.sections.find(item => item.id === link.targetId);
      const labels = understandingRelationLabels[link.kind];
      return target && labels ? [`${zh ? "我的关系" : "My relation"}: ${old.title} → ${labels[zh ? 0 : 1]} → ${target.title}`] : [];
    }),
  ].filter(Boolean).join("\n\n");
  for (const old of previous.sections.filter(section => section.structureEdited || section.responsibility !== undefined || section.understandingLinks !== undefined)) {
    const id = matches.get(old.id);
    const kept = (old.understandingLinks ?? []).filter(link => matches.has(link.targetId));
    const lost = (old.understandingLinks ?? []).filter(link => !matches.has(link.targetId));
    if (id) patches.set(id, { responsibility: old.responsibility, structureEdited: old.structureEdited, understandingLinks: old.understandingLinks === undefined ? undefined : kept.map(link => ({ ...link, targetId: matches.get(link.targetId)! })) });
    const text = id ? describe(old, lost, "") : describe(old);
    if (text) detached.push({ title: old.title, text, sources: previous.evidence.filter(ref => old.evidenceIds.includes(ref.id)) });
  }
  return { sections: next.sections.map(section => patches.has(section.id) ? { ...section, ...patches.get(section.id) } : section), detached };
}

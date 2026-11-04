import type { FocusSession } from "./focus-session";

type SavedNote = NonNullable<FocusSession["detachedNotes"]>[number];

/** Read old personal records without rewriting graphs, sources or article content. */
export function understandingNotes(session: FocusSession): SavedNote[] {
  const overrides = new Set(session.detachedNotes?.map(note => note.understandingNoteId).filter(Boolean));
  return [
    ...session.sections.flatMap(section => (section.understandingPath ?? []).filter(point => point.origin === "user" || point.userEdited).map(point => ({
      understandingNoteId: `chapter:${section.id}:${point.id}`, title: point.title,
      text: point.personalExplanation?.trim() || point.body,
      section: { id: section.id, title: section.title },
      sources: session.evidence.filter(ref => point.evidenceIds.includes(ref.id)),
    }))),
    ...(session.projectUnderstanding?.nodes ?? []).filter(point => point.personalExplanation?.trim() || point.id.startsWith("personal-concept:")).map(point => ({
      understandingNoteId: `project:${point.id}`, title: point.title,
      text: point.personalExplanation?.trim() || point.responsibility,
      sources: session.evidence.filter(ref => session.sections.some(section => point.sectionIds.includes(section.id) && section.evidenceIds.includes(ref.id))),
    })),
  ].filter(note => note.text.trim() && !overrides.has(note.understandingNoteId));
}


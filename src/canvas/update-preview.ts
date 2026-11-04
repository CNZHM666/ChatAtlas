import type { FocusSession } from "../shared/focus-session";

/** Compare saved versions; this does not estimate the executed AI scope. */
export function updatePreview(previous: FocusSession, next: FocusSession) {
  const same = (left: FocusSession["sections"][number], right: FocusSession["sections"][number]) => left.title === right.title && left.body === right.body && left.kind === right.kind;
  const previousBySection = new Map<string, FocusSession["sections"][number]>(), used = new Set<string>();
  for (const section of next.sections) {
    const candidates = previous.sections.filter(item => !used.has(item.id));
    const byTitle = candidates.filter(item => item.title === section.title && item.kind === section.kind);
    const byText = candidates.filter(item => item.body === section.body && item.kind === section.kind);
    // Generated section-N IDs are ordinals and can shift after a chapter is
    // inserted. Do not compare an unrelated chapter solely by that ID.
    const stable=next.wikiContentReview?.basisSessionId===previous.id?candidates.find(item=>item.id===section.id):undefined;
    const old = stable ?? (byTitle.length === 1 ? byTitle[0] : byText.length === 1 ? byText[0] : candidates.find(item => item.id === section.id && (!/^section-\d+$/u.test(item.id) || item.title === section.title)));
    if (old) { used.add(old.id); previousBySection.set(section.id, old); }
  }
  const changed = next.sections.filter(section => !previousBySection.has(section.id) || !same(previousBySection.get(section.id)!, section));
  const removed = previous.sections.filter(section => !used.has(section.id));
  const unchanged = next.sections.length - changed.length;
  const noteKeys = (session: FocusSession) => [
    ...Object.values(session.sectionNotes ?? {}).filter(note => note.text.trim() && !note.deletedAt).map(note => note.text.trim()),
    ...(session.detachedNotes ?? []).filter(note => !note.deletedAt && note.text.trim()).map(note => note.text.trim()),
    ...(session.notes.trim() ? [session.notes.trim()] : []),
  ];
  // Chapter notes may move into detached notes with a new title after a chapter
  // is replaced. Count the preserved text, including carry-forward wrappers.
  const nextNotes = noteKeys(next);
  const retainedNotes = noteKeys(previous).filter(text => nextNotes.some(nextText => nextText === text || nextText.includes(text))).length;
  const personalCards = (session: FocusSession) => [...session.sections, ...session.sections.flatMap(section => section.understandingPath ?? [])].filter(section => section.origin === "user" || section.userEdited);
  const nextCards = personalCards(next);
  const preservedCards = personalCards(previous).filter(section => nextCards.some(item => item.id === section.id && same(item, section))).length;
  return { changed, removed, unchanged, retainedNotes, preservedCards, previousBySection };
}

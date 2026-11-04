import { expect, it } from "vitest";
import type { FocusSession } from "../shared/focus-session";
import { updatePreview } from "./update-preview";
const previous: FocusSession = { id: "s", title: "Review", goal: "Review", mode: "review", sourceConversationIds: [], evidence: [], sections: [{ id: "a", title: "A", body: "Old explanation", transition: "", evidenceIds: [], kind: "review" }, { id: "b", title: "My understanding", body: "Personal text", origin: "user", transition: "", evidenceIds: [], kind: "review" }], activeSectionId: "a", completedSectionIds: [], notes: "Shared text", sectionNotes: { a: { text: "Personal note", evidenceIds: [], updatedAt: 1 } }, detachedNotes: [{ title: "Deleted", text: "Removed note", deletedAt: 1 }], createdAt: 1, updatedAt: 1 };
it("compares actual text changes while retaining authored sections and active notes, ignoring trash counts", () => {
  const next = { ...previous, id: "new", sections: [{ ...previous.sections[0], body: "Updated explanation", evidenceIds: ["remapped"] }, previous.sections[1]] };
  expect(updatePreview(previous, next)).toMatchObject({ changed: [next.sections[0]], removed: [], unchanged: 1, retainedNotes: 2, preservedCards: 1 });
  expect(updatePreview(previous, { ...previous, sections: previous.sections.map(section => ({ ...section, evidenceIds: ["new-id"] })) }).changed).toEqual([]);
  const local = { ...previous, sections: [{ ...previous.sections[0], understandingPath: [{ ...previous.sections[1], id: "chapter-personal" }] }, previous.sections[1]] };
  expect(updatePreview(local, local).preservedCards).toBe(2);
});
it("counts notes retained after renaming or moving out of a replaced chapter", () => {
  const next = { ...previous, sectionNotes: {}, detachedNotes: [{ title: "A renamed note", text: "Personal note" }] };
  expect(updatePreview(previous, next).retainedNotes).toBe(2);
  expect(updatePreview(previous, { ...next, detachedNotes: [{ title: "A", text: "Personal note\n\n待复习：下次的问题" }] }).retainedNotes).toBe(2);
});
it("does not count unchanged chapters as edited when generated ordinal IDs shift after insertion", () => {
  const old = { ...previous, sections: previous.sections.map((section, index) => ({ ...section, id: `section-${index + 1}` })) };
  const next = { ...old, sections: [{ ...old.sections[0], title: "New prerequisite", body: "New text" }, ...old.sections.map((section, index) => ({ ...section, id: `section-${index + 2}` }))] };
  const delta = updatePreview(old, next);
  expect(delta.changed).toEqual([next.sections[0]]); expect(delta.unchanged).toBe(2); expect(delta.removed).toEqual([]);
  expect(delta.previousBySection.has(next.sections[0].id)).toBe(false);
  expect(delta.previousBySection.get(next.sections[1].id)?.body).toBe(old.sections[0].body);
});

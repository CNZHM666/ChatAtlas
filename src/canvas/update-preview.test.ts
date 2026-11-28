import { expect, it } from "vitest";
import type { FocusSession } from "../shared/focus-session";
import { applySelectiveUpdatePreview, updatePreview } from "./update-preview";
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

it("distinguishes new chapters, formatting and changed language or decisions", () => {
  const [a, b] = previous.sections;
  const proposed = { ...previous, sections: [{ ...a, body: "**Old explanation**" }, { ...b, body: "Change to the agreed workflow" },
    { ...a, id: "c", title: "New section", body: "New detail", claims: [{ text: "New detail", quote: "New detail", evidenceIds: [] }] }] };
  expect([...updatePreview(previous, proposed).changeSummaryBySection]).toEqual([
    ["a", { kind: "polish", addedClaims: 0, removedClaims: 0, lengthDelta: 4 }],
    ["b", expect.objectContaining({ kind: "substantive" })],
    ["c", expect.objectContaining({ kind: "added", addedClaims: 1 })],
  ]);
  const prose = { ...a, body: "例如，可以通过本地索引查找。" };
  const phrased = { ...prose, body: "比如，可通过本地索引查找。" };
  expect(updatePreview({ ...previous, sections: [prose] }, { ...proposed, sections: [phrased] }).changeSummaryBySection.get(a.id)?.kind).toBe("polish");
  const first = { ...a, claims: [{ text: a.body, quote: "", evidenceIds: [], holder: "ai" as const }] };
  const second = { ...first, claims: [{ ...first.claims[0], holder: "decided" as const, userDecided: true }] };
  expect(updatePreview({ ...previous, sections: [first] }, { ...proposed, sections: [second] }).changeSummaryBySection.get(a.id))
    .toEqual({ kind: "substantive", addedClaims: 1, removedClaims: 1, lengthDelta: 0 });
});

it("keeps old evidence, notes and relevant decision units when only one chapter is adopted", () => {
  const unit = (id: string, statement: string) => ({
    id, subject: id, statement, kind: "decision" as const, details: [],
    evidence: { conversationId: "c", messageId: id, messageIndex: 0, evidenceId: id, role: "user" as const, pasted: false, quote: statement },
    adoption: { status: "user_decision" as const }, delivery: "unknown" as const,
  });
  const ref = (id: string, messageId: string, excerpt: string) => ({ id, conversationId: "c", messageId, title: "Chat", excerpt });
  const session = (id: string, ids: string[], texts: string[]): FocusSession => ({
    ...previous, id, activeSectionId: "b", sourceConversationIds: ["c"],
    evidence: ids.map((messageId, index) => ref(`shared-${index}`, messageId, texts[index])),
    sections: previous.sections.map((section, index) => ({ ...section, body: texts[index], evidenceIds: [`shared-${index}`],
      claims: [{ text: texts[index], quote: texts[index], evidenceIds: [`shared-${index}`], unitIds: [ids[index]] }] })),
    sectionNotes: { b: { text: "My note", evidenceIds: ["shared-1"], updatedAt: 1 } },
    wikiKnowledge: { version: 1, status: "complete", materials: 2, generatedAt: 1,
      decisions: Object.fromEntries(ids.map(unitId => [unitId, { verdict: "confirmed", at: 1 }])),
      batches: ids.map((unitId, index) => ({ sourceIds: [unitId], status: "ok", units: [unit(unitId, texts[index])], rejected: {} })) },
  });
  const old = session("old", ["old-a", "old-b"], ["Old A", "Old B"]);
  const proposal = session("new", ["new-a", "new-b"], ["New A", "New B"]);
  const before = structuredClone(old), proposed = structuredClone(proposal);
  const result = applySelectiveUpdatePreview(old, proposal, new Set(["a"]));
  expect(result.sections.map(section => section.body)).toEqual(["New A", "Old B"]);
  expect(result.sections[1]).toBe(old.sections[1]);
  expect(result.activeSectionId).toBe("b");
  expect(result.sectionNotes?.b).toBe(old.sectionNotes?.b);
  const evidence = new Map(result.evidence.map(item => [item.id, item.messageId]));
  for (const section of result.sections) {
    const ids = [...section.evidenceIds, ...section.claims?.flatMap(claim => claim.evidenceIds) ?? []];
    expect(ids.every(id => evidence.get(id) === (section.id === "a" ? "new-a" : "old-b"))).toBe(true);
  }
  expect(result.wikiKnowledge?.batches.flatMap(batch => batch.units.map(item => item.id))).toEqual(["old-b", "new-a"]);
  expect(Object.keys(result.wikiKnowledge!.decisions!)).toEqual(["old-b", "new-a"]);
  expect(applySelectiveUpdatePreview(old, proposal, new Set(["a", "b"]))).toBe(proposal);
  expect(applySelectiveUpdatePreview(old, proposal, new Set())).toBe(old);
  expect(old).toEqual(before);
  expect(proposal).toEqual(proposed);
});

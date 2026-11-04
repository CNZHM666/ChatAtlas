import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { getDatabase } from "./db";
import { projectReader } from "./project-reader";
import type { FocusSession } from "../shared/focus-session";
const project = { id: "project", name: "Project", type: "topic" as const, sourceConversationIds: ["chosen"], createdAt: 1, updatedAt: 1 };
beforeEach(async () => { const db = await getDatabase(); for (const store of ["focusSessions", "cards", "knowledgeCards", "canvasMemberships", "sourceRelations", "knowledgeRelations", "anchors"] as const) await db.clear(store); });
it("opens the latest accepted result at its saved chapter, leaving unaccepted previews separate", async () => {
  const db = await getDatabase();
  const session: FocusSession = { id: "accepted", canvasId: project.id, goal: "Review", title: "Result", mode: "work", sections: [{ id: "one", title: "First", kind: "finding", body: "Body", transition: "", evidenceIds: [] }], sourceConversationIds: ["chosen"], evidence: [], activeSectionId: "one", completedSectionIds: [], notes: "My edits", createdAt: 1, updatedAt: 1 };
  await db.put("focusSessions", session); await db.put("focusSessions", { ...session, id: "preview", status: "preview", updatedAt: 2 });
  expect(await projectReader(project)).toEqual(session);
  expect(await db.get("focusSessions", "preview")).toMatchObject({ status: "preview" });
});
it("creates an empty local reader once without inventing analyzed content or sources", async () => {
  const first = await projectReader(project), second = await projectReader(project);
  expect(first).toEqual(second);
  expect(first).toMatchObject({ sections: [], sourceConversationIds: ["chosen"], canvasId: project.id });
  expect(first.coverage).toBeUndefined();
  expect(await (await getDatabase()).count("focusSessions")).toBe(1);
});
it("reads current knowledge cards in saved order and keeps references within confirmed scope", async () => {
  const db = await getDatabase();
  for (const id of ["first", "second"]) {
    await db.put("knowledgeCards", { id, homeCanvasId: project.id, title: id, body: "Saved body", type: "concept", tags: [], origin: "ai", userEdited: false, createdAt: 1, updatedAt: 1, evidenceRefs: [{ conversationId: "chosen", messageId: id, excerpt: "Saved source" }, { conversationId: "excluded", messageId: "other" }] });
    await db.put("canvasMemberships", { id: `${project.id}:${id}`, canvasId: project.id, cardId: id, x: 0, y: 0, userPositioned: false, createdAt: 1, updatedAt: 1 });
  }
  const result = await projectReader({ ...project, readingPathCardIds: ["second", "first"] });
  expect(result.sections.map(s => s.id)).toEqual(["second", "first"]);
  expect(result.sections.every(s => s.evidenceIds.length === 1)).toBe(true);
  expect(result.evidence.map(e => e.conversationId)).toEqual(["chosen", "chosen"]);
  expect(await db.count("knowledgeCards")).toBe(2);
});
it("preserves old card text and references without broadening an explicitly empty scope", async () => {
  const db = await getDatabase();
  await db.put("cards", { id: "legacy", canvasId: project.id, kind: "note", title: "My note", description: "Meaning", notes: "Correction", tags: [], x: 0, y: 0, conversationIds: ["chosen"], anchorIds: [], evidenceRefs: [{ conversationId: "chosen", questionId: "question", excerpt: "Original" }], origin: "user", createdAt: 1, updatedAt: 1 });
  const result = await projectReader({ ...project, sourceConversationIds: [] });
  expect(result.sections[0]).toMatchObject({ body: "Meaning\n\nCorrection", origin: "user", evidenceIds: [] });
  expect(result.sourceConversationIds).toEqual([]);
  expect(result.evidence).toEqual([]);
  expect((await db.get("cards", "legacy"))?.evidenceRefs).toHaveLength(1);
});

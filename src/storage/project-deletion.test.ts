import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import type { FocusSession } from "../shared/focus-session";
import { OVERVIEW_CANVAS_ID } from "../shared/constants";
import { getDatabase } from "./db";
import { deleteProject, restoreProject, listDeletedProjects, emptyProjectTrash } from "./project-deletion";
import { listCanvases } from "./canvases";
import { listFocusSessions } from "./focus-sessions";
import { buildSidecarData } from "./sidecar";
import { listSearchableKnowledgeCards } from "./knowledge-graph";
import { BACKUP_STORES, createAtlasBackup, parseAtlasBackup, restoreAtlasBackup } from "./atlas-backup";

beforeEach(async () => { const db = await getDatabase(); for (const store of BACKUP_STORES) await db.clear(store); });

it("deletes every project version from navigation, resume and sidecar while retaining material and restoring edits", async () => {
  const db = await getDatabase();
  await db.put("canvases", { id: "project", name: "Hardware", type: "topic", createdAt: 1, updatedAt: 1 });
  const session: FocusSession = { id: "draft", canvasId: "project", mode: "work", title: "Hardware plan", goal: "Understand", sourceConversationIds: ["source"], sections: [{ id: "one", title: "Design", body: "Personal edits", kind: "review", transition: "", evidenceIds: [] }], evidence: [], notes: "My verification notes", activeSectionId: "one", completedSectionIds: [], createdAt: 1, updatedAt: 2 };
  await db.put("focusSessions", session);
  await db.put("focusSessions", { ...session, id: "accepted", updatedAt: 3 });
  await db.put("focusSessions", { ...session, id: "independent", canvasId: undefined });
  await db.put("messages", { id: "raw", conversationId: "source", content: "Original material", messageIndex: 0, role: "user", preview: "", contentHash: "raw", createdAt: 1, updatedAt: 1 });
  await deleteProject("project");
  expect((await listCanvases()).map(item => item.id)).not.toContain("project");
  expect((await listFocusSessions()).map(item => item.id)).toEqual(["independent"]);
  const archived = await listDeletedProjects();
  expect(archived).toHaveLength(1);
  expect(buildSidecarData("source", [session], archived).readings).toEqual([]);
  expect(await db.get("messages", "raw")).toMatchObject({ content: "Original material" });
  const backup = parseAtlasBackup(JSON.stringify(await createAtlasBackup()));
  await restoreAtlasBackup(backup);
  expect(await listDeletedProjects()).toHaveLength(1);
  await restoreProject("project");
  expect(await listDeletedProjects()).toEqual([]);
  expect(await listFocusSessions()).toHaveLength(3);
  expect(await db.get("focusSessions", "draft")).toMatchObject({ notes: session.notes, sections: session.sections });
});

it("keeps shared cards searchable through another project, but hides cards owned only by the deleted project", async () => {
  const db = await getDatabase();
  for (const id of ["deleted", "other"]) await db.put("canvases", { id, name: id, createdAt: 1, updatedAt: 1 });
  for (const id of ["shared", "private"]) await db.put("knowledgeCards", { id, title: id, body: "Saved", homeCanvasId: "deleted", type: "concept", tags: [], origin: "user", userEdited: true, evidenceRefs: [], createdAt: 1, updatedAt: 1 });
  for (const [cardId, canvasId] of [["shared", "deleted"], ["shared", "other"], ["private", "deleted"]]) await db.put("canvasMemberships", { id: `${cardId}:${canvasId}`, cardId, canvasId, userPositioned: false, x: 0, y: 0, createdAt: 1, updatedAt: 1 });
  await deleteProject("deleted");
  expect(await listSearchableKnowledgeCards()).toEqual([expect.objectContaining({ id: "shared", canvasId: "other" })]);
  await restoreProject("deleted");
  expect(await listSearchableKnowledgeCards()).toHaveLength(2);
});

it("cannot delete the Workbench overview", async () => {
  await listCanvases();
  await expect(deleteProject(OVERVIEW_CANVAS_ID)).rejects.toThrow();
  expect((await listCanvases())[0].id).toBe(OVERVIEW_CANVAS_ID);
});
it("empties only trashed projects and versions, retaining shared source text and cards owned by a surviving project", async () => {
  const db = await getDatabase();
  for (const id of ["trash", "live"]) await db.put("canvases", { id, name: id, createdAt: 1, updatedAt: 1 });
  const base: FocusSession = { id: "trashed-session", canvasId: "trash", mode: "work", title: "Plan", goal: "Plan", sourceConversationIds: ["source"], sections: [], evidence: [], notes: "Personal notes", activeSectionId: "", completedSectionIds: [], createdAt: 1, updatedAt: 1 };
  await db.put("focusSessions", base);
  await db.put("focusSessions", { ...base, id: "live-session", canvasId: "live" });
  await db.put("focusSessions", { ...base, id: "deleted-version", canvasId: "live", deletedAt: 1 });
  await db.put("messages", { id: "raw", conversationId: "source", content: "Original discussion", role: "user", messageIndex: 0, preview: "", contentHash: "", createdAt: 1, updatedAt: 1 });
  for (const id of ["shared", "exclusive"]) await db.put("knowledgeCards", { id, homeCanvasId: "trash", title: id, body: "User text", type: "concept", tags: [], origin: "user", userEdited: true, createdAt: 1, updatedAt: 1 });
  for (const [cardId, canvasId] of [["shared", "trash"], ["shared", "live"], ["exclusive", "trash"]]) await db.put("canvasMemberships", { id: `${cardId}:${canvasId}`, cardId, canvasId, x: 0, y: 0, userPositioned: true, createdAt: 1, updatedAt: 1 });
  await deleteProject("trash"); await emptyProjectTrash();
  expect(await listDeletedProjects()).toEqual([]);
  expect(await db.get("canvases", "trash")).toBeUndefined();
  expect((await db.getAll("focusSessions")).map(item => item.id)).toEqual(["live-session"]);
  expect(await db.get("knowledgeCards", "exclusive")).toBeUndefined();
  expect(await db.get("knowledgeCards", "shared")).toMatchObject({ homeCanvasId: "live", body: "User text" });
  expect(await db.get("messages", "raw")).toMatchObject({ content: "Original discussion" });
  await restoreProject("trash");
  expect(await db.get("canvases", "trash")).toBeUndefined();
});

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { FocusSession } from "../shared/focus-session";
import { saveProjectQueryTurn, readProjectQueryThread } from "./project-query-threads";
import { getDatabase } from "./db";
import { attachFocusSession, focusMarkdown, listFocusSessions, saveFocusSession } from "./focus-sessions";
import { BACKUP_STORES, createAtlasBackup, parseAtlasBackup, restoreAtlasBackup } from "./atlas-backup";

const session: FocusSession = { id: "s", goal: "Review stability", mode: "review", title: "Stability", sourceConversationIds: ["new-source"], evidence: [{ id: "e1", conversationId: "new-source", messageId: "m", title: "Discussion", excerpt: "A supported explanation" }], sections: [{ id: "step", title: "Poles", kind: "review", body: "Original understanding", transition: "", evidenceIds: ["e1"] }], activeSectionId: "step", completedSectionIds: [], notes: "My later understanding", createdAt: 1, updatedAt: 2 };
beforeEach(async () => { const db = await getDatabase(); for (const name of BACKUP_STORES) await db.clear(name); });

describe("independent reading sessions", () => {
  it("attaches saved prose with review feedback without confirming facts", async () => {
    const draft = { ...session, status: "preview" as const, sections: session.sections.map(section => ({ ...section, reviewIssue: "纠正仍需核验" })) };
    await saveFocusSession(draft);
    await expect(attachFocusSession(draft, { name: "待确认项目" })).rejects.toThrow("请先保存并查看");
    expect(await (await getDatabase()).getAll("canvases")).toEqual([]);
    expect((await listFocusSessions())[0].sections[0].body).toBe(session.sections[0].body);
    const saved = await attachFocusSession({ ...draft, status: "ready" }, { name: "用户保留的项目" });
    expect(saved.sections[0].reviewIssue).toBe("纠正仍需核验");
    expect(saved.projectMaintenance?.acceptedSignature).toBeUndefined();
  });
  it("persists without a space and round trips with backup including edits and progress", async () => {
    await saveFocusSession({ ...session, completedSectionIds: ["step"] });
    expect(await (await getDatabase()).getAll("canvases")).toEqual([]);
    const backup = await createAtlasBackup();
    await (await getDatabase()).clear("focusSessions");
    await restoreAtlasBackup(backup);
    expect((await listFocusSessions())[0]).toMatchObject({ notes: session.notes, activeSectionId: "step", completedSectionIds: ["step"] });
    expect(focusMarkdown(session)).toContain("> A supported explanation");
    expect(focusMarkdown(session)).not.toContain("new-source / m");
  });

  it("adds to a legacy space without losing existing linked sources or changing its reading order", async () => {
    const db = await getDatabase();
    await db.put("canvases", { id: "space", name: "Control", readingPathCardIds: ["old"], readingPathUserEdited: true, createdAt: 1, updatedAt: 1 });
    await db.put("canvasMemberships", { id: "membership", canvasId: "space", cardId: "old", x: 0, y: 0, userPositioned: true, createdAt: 1, updatedAt: 1 });
    await db.put("knowledgeCards", { id: "old", title: "Old", type: "concept", tags: [], origin: "user", evidenceRefs: [{ conversationId: "old-source" }], createdAt: 1, updatedAt: 1, userEdited: true });
    const saved = await attachFocusSession(session, { canvasId: "space" });
    expect(saved.canvasId).toBe("space");
    expect(await db.get("canvases", "space")).toMatchObject({ sourceConversationIds: ["old-source", "new-source"], readingPathCardIds: ["old"], readingPathUserEdited: true });
  });

  it("saves question history with the project atomically and keeps existing project answers", async () => {
    await saveProjectQueryTurn("result:s", { id: "q1", question: "Why?", revision: "v1", createdAt: 1, chapters: [], answer: session });
    const saved = await attachFocusSession(session, { name: "Original discussion" });
    const id = `project:${saved.canvasId}`;
    expect(await readProjectQueryThread(id)).toEqual(await readProjectQueryThread("result:s"));
    await saveProjectQueryTurn(id, { id: "q2", question: "Next?", revision: "v1", createdAt: 2, chapters: [], clarification: "Which part?" });
    await attachFocusSession(session, { canvasId: saved.canvasId! });
    expect((await readProjectQueryThread(id)).map(turn => turn.id)).toEqual(["q1", "q2"]);
    const db = await getDatabase(); expect(await db.get("focusSessions", session.id)).toMatchObject({ canvasId: saved.canvasId, notes: session.notes });
    expect(await db.get("canvases", saved.canvasId!)).toMatchObject({ sourceConversationIds: session.sourceConversationIds });
  });

  it("accepts older backups and rejects invalid destination without saving half a result", async () => {
    const backup = await createAtlasBackup();
    delete (backup.stores as Partial<typeof backup.stores>).focusSessions;
    expect(parseAtlasBackup(JSON.stringify(backup)).stores.focusSessions).toEqual([]);
    await restoreAtlasBackup(backup);
    await expect(attachFocusSession(session, { canvasId: "missing" })).rejects.toThrow();
    expect(await listFocusSessions()).toEqual([]);
  });
});

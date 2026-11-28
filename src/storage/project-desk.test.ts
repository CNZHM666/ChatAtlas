// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleProjectFile } from "../background/project-files";
import { AUTO_FILE_LIMIT, encodeProjectChunk } from "../shared/project-files";
import { createAtlasBackup, restoreAtlasBackup } from "./atlas-backup";
import { getDatabase } from "./db";
import { createLivingProject } from "./focus-sessions";
import { deleteProject, emptyProjectTrash } from "./project-deletion";
import { listProjectFiles, projectDesk, saveProjectFile, saveProjectSticky, setAutomaticProjectFiles, uploadProjects } from "./project-desk";

beforeEach(async () => {
  const db = await getDatabase();
  for (const name of ["focusSessions", "canvases", "projectFiles", "projectDesks"] as const) await db.clear(name);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("deduplicates by bytes across projects and retains sticky notes and shared files through backup and Trash", async () => {
  const a = (await createLivingProject("First", "", "en")).canvasId!;
  const b = (await createLivingProject("Second", "", "en")).canvasId!;
  const bytes = new TextEncoder().encode("Project notes").buffer;
  await Promise.all([
    saveProjectFile(a, { name: "first.md", type: "text/markdown", size: bytes.byteLength }, bytes, true),
    saveProjectFile(b, { name: "same.txt", type: "text/plain", size: bytes.byteLength }, bytes, true),
  ]);
  await saveProjectSticky(a, { id: "one", text: "Ask about the retry behavior", updatedAt: 0 });
  await setAutomaticProjectFiles(a, "chat", true);
  expect(await (await getDatabase()).count("projectFiles")).toBe(1);
  const backup = await createAtlasBackup();
  await (await getDatabase()).clear("projectFiles");
  await restoreAtlasBackup(backup);
  expect((await projectDesk(a)).notes[0].text).toBe("Ask about the retry behavior");
  expect((await projectDesk(a)).autoChats).toEqual([]);
  expect(await (await listProjectFiles(b))[0].blob.text()).toBe("Project notes");
  await deleteProject(a);
  await emptyProjectTrash();
  expect(await listProjectFiles(a)).toEqual([]);
  expect(await listProjectFiles(b)).toHaveLength(1);
  expect((await projectDesk(a)).notes).toEqual([]);
});

it("accepts upload bytes only for the associated chat or its explicit automatic project", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const project = await createLivingProject("Current", "", "en");
  const db = await getDatabase();
  const chat = "4dd3995d-9d41-4f61-8e77-78bd1f75c3e8";
  const url = `https://chatgpt.com/c/${chat}`;
  vi.stubGlobal("chrome", { tabs: { get: vi.fn().mockResolvedValue({ id: 8, url, active: true }) },
    runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) } });
  const sender = { tab: { id: 8 }, documentId: "document", frameId: 0 } as chrome.runtime.MessageSender;
  const bytes = new TextEncoder().encode("Contents");
  const info = { name: "notes.md", type: "text/markdown", size: bytes.length };
  const start = { type: "ATLAS_PROJECT_FILE_START" as const, conversationId: chat, projectId: project.canvasId!, manual: true, info };
  expect(await handleProjectFile(start, sender)).toEqual({ ok: false });
  await db.put("focusSessions", { ...project, sidecarConversationIds: [chat] });
  expect(await uploadProjects(chat)).toEqual([{ id: project.canvasId, name: "Current", auto: false }]);
  expect(await handleProjectFile({ ...start, manual: false }, sender)).toEqual({ ok: false });
  await setAutomaticProjectFiles(project.canvasId!, chat, true);
  expect(await handleProjectFile({ ...start, manual: false, info: { ...info, size: AUTO_FILE_LIMIT + 1 } }, sender)).toEqual({ ok: false });
  const staged = await handleProjectFile({ ...start, manual: false }, sender);
  expect(staged).toMatchObject({ ok: true, token: expect.any(String) });
  const token = (staged as { token: string }).token;
  const packet = { type: "ATLAS_PROJECT_FILE_CHUNK" as const, token, offset: 0, data: encodeProjectChunk(bytes) };
  expect(await handleProjectFile(packet, { ...sender, documentId: "other" })).toEqual({ ok: false });
  expect(await handleProjectFile(packet, sender)).toEqual({ ok: true });
  expect(await handleProjectFile({ type: "ATLAS_PROJECT_FILE_FINISH", token }, sender)).toEqual({ ok: true });
  expect(await (await listProjectFiles(project.canvasId!))[0].blob.text()).toBe("Contents");
});

it("hands a drag only to its bound tab and preserves a composer-specific failure", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const projectId = (await createLivingProject("Drag target", "", "en")).canvasId!;
  const chat = "4dd3995d-9d41-4f61-8e77-78bd1f75c3e8";
  const url = `https://chatgpt.com/c/${chat}`;
  const bytes = new TextEncoder().encode("Draft");
  await saveProjectFile(projectId, { name: "draft.md", type: "text/markdown", size: bytes.length }, bytes.buffer, true);
  const [file] = await listProjectFiles(projectId);
  const sendMessage = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, reason: "no-file-target" });
  vi.stubGlobal("chrome", { tabs: { get: vi.fn().mockResolvedValue({ id: 8, url, active: true }), sendMessage },
    runtime: { getURL: (path: string) => `chrome-extension://atlas/${path}` } });
  const token = crypto.randomUUID();
  await expect(handleProjectFile({ type: "ATLAS_PROJECT_FILE_REUSE", projectId, fileId: file.id, conversationId: chat, tabId: 8, token },
    { url: "chrome-extension://atlas/sidecar.html?native=1" })).resolves.toEqual({ ok: true });
  const drop = { type: "ATLAS_PROJECT_FILE_DROP" as const, conversationId: chat, token };
  await expect(handleProjectFile(drop, { tab: { id: 9 } as chrome.tabs.Tab, frameId: 0 })).resolves.toEqual({ ok: false, reason: "drag-expired" });
  await expect(handleProjectFile(drop, { tab: { id: 8 } as chrome.tabs.Tab, frameId: 0 })).resolves.toEqual({ ok: false, reason: "no-file-target" });
  expect(sendMessage).toHaveBeenNthCalledWith(1, 8, expect.objectContaining({ type: "ATLAS_PROJECT_FILE_DRAG_READY", token }), { frameId: 0 });
  expect(sendMessage).toHaveBeenNthCalledWith(2, 8, expect.objectContaining({ type: "ATLAS_PROJECT_FILE_RECEIVE", token, data: encodeProjectChunk(bytes) }), { frameId: 0 });
});

it("supports files, sticky notes, and auto-uploads for workbench projects without a canvasId", async () => {
  const db = await getDatabase();
  const chat = "4dd3995d-9d41-4f61-8e77-78bd1f75c3e9";
  await db.put("focusSessions", {
    id: "wb-session-1", rootSessionId: "wb-root-1", title: "AI Hardware Canvas", goal: "", mode: "work", status: "ready",
    createdAt: 10, updatedAt: 10, sourceConversationIds: [chat], sections: [], evidence: [], activeSectionId: "",
    completedSectionIds: [], notes: "",
  });
  const bytes = new TextEncoder().encode("Board spec").buffer;
  await saveProjectFile("wb-root-1", { name: "board.md", type: "text/markdown", size: bytes.byteLength }, bytes, true);
  await saveProjectSticky("wb-root-1", { id: "s1", text: "Check MOSFET rating", updatedAt: 0 });
  await saveProjectSticky("wb-root-1", { id: "s2", text: "Always verify 3.3V logic", updatedAt: 0, pinned: true });
  await saveProjectSticky("wb-root-1", { id: "s3", text: "Later unpinned note", updatedAt: 0 });
  await setAutomaticProjectFiles("wb-root-1", chat, true);
  expect((await listProjectFiles("wb-root-1")).map(file => file.name)).toEqual(["board.md"]);
  expect((await projectDesk("wb-root-1")).notes.map(note => note.id)).toEqual(["s2", "s3", "s1"]);
  expect(await uploadProjects(chat)).toEqual([{ id: "wb-root-1", name: "AI Hardware Canvas", auto: true }]);
});

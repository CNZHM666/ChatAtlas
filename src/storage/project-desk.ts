import { AUTO_FILE_LIMIT, PROJECT_FILE_DRAG, PROJECT_FILE_LIMIT, supportedProjectFile, type ProjectFileInfo } from "../shared/project-files";
import { projectIdentity } from "../shared/project-continuation";
import type { FocusSession } from "../shared/focus-session";
import type { AtlasCanvas } from "../shared/types";
import { getDatabase } from "./db";
import { isDeletedProject } from "./project-deletion";

export const PROJECT_STICKY_DRAG = "application/x-atlas-sticky";
export const STICKY_MAX_LENGTH = 2000;

type DragTransferLike = { types?: ArrayLike<string>; getData?: (format: string) => string } | null | undefined;

export function isExternalStickyTextDrag(transfer: DragTransferLike): boolean {
  if (!transfer) return false;
  const types = Array.from(transfer.types ?? []);
  if (types.includes(PROJECT_STICKY_DRAG) || types.includes(PROJECT_FILE_DRAG) || types.includes("Files")) return false;
  return types.includes("text/plain") || types.includes("text/html");
}

export function extractDroppedStickyText(transfer: DragTransferLike): { text: string; truncated: boolean } {
  if (!transfer?.getData) return { text: "", truncated: false };
  let raw = transfer.getData("text/plain") || "";
  if (!raw.trim()) {
    const html = transfer.getData("text/html") || "";
    if (html.trim()) {
      raw = typeof DOMParser === "function"
        ? (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "")
        : html.replace(/<[^>]+>/g, " ");
    }
  }
  const normalized = raw.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return { text: "", truncated: false };
  const truncated = normalized.length > STICKY_MAX_LENGTH;
  return { text: (truncated ? normalized.slice(0, STICKY_MAX_LENGTH) : normalized).trim(), truncated };
}

export interface ProjectSticky { id: string; text: string; updatedAt: number; pinned?: boolean }
export interface ProjectDesk { id: string; notes: ProjectSticky[]; autoChats: string[] }
export interface ProjectFile extends ProjectFileInfo { id: string; projectIds: string[]; blob: Blob; addedAt: number }

const emptyDesk = (id: string): ProjectDesk => ({ id, notes: [], autoChats: [] });
const isLiveWorkSession = (item: FocusSession) => item.mode === "work" && item.status !== "preview" && !item.deletedAt && !item.ledgerTest;

async function isProjectAvailable(
  canvases: { get: (id: string) => Promise<AtlasCanvas | undefined> },
  sessions: { getAll: () => Promise<FocusSession[]> },
  projectId: string,
) {
  const canvas = await canvases.get(projectId);
  if (canvas) return !isDeletedProject(canvas);
  const all = await sessions.getAll();
  const match = all.find(item => isLiveWorkSession(item) && projectIdentity(item) === projectId);
  if (!match) return false;
  if (match.canvasId) {
    const owned = await canvases.get(match.canvasId);
    if (!owned || isDeletedProject(owned)) return false;
  }
  return true;
}

export async function projectDesk(projectId: string): Promise<ProjectDesk> {
  return await (await getDatabase()).get("projectDesks", projectId) ?? emptyDesk(projectId);
}

export async function listProjectFiles(projectId: string) {
  return (await (await getDatabase()).getAllFromIndex("projectFiles", "by-project", projectId)).sort((a, b) => b.addedAt - a.addedAt);
}

export async function saveProjectFile(projectId: string, info: ProjectFileInfo, bytes: ArrayBuffer, manual: boolean) {
  if (!supportedProjectFile(info) || bytes.byteLength !== info.size || info.size > (manual ? PROJECT_FILE_LIMIT : AUTO_FILE_LIMIT)) throw new Error("File size or format is unsupported");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const id = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  const db = await getDatabase();
  const tx = db.transaction(["projectFiles", "canvases", "focusSessions"], "readwrite");
  const available = await isProjectAvailable(tx.objectStore("canvases"), tx.objectStore("focusSessions"), projectId);
  const files = tx.objectStore("projectFiles");
  if (!available) { await tx.done; throw new Error("Project unavailable"); }
  const existing = await files.get(id);
  const name = Array.from(info.name, character => character.charCodeAt(0) < 32 || character === "/" || character === "\\" ? "_" : character).join("");
  if (!existing?.projectIds.includes(projectId)) await files.put(existing
    ? { ...existing, projectIds: [...existing.projectIds, projectId] }
    : { ...info, name, type: info.type.toLowerCase(), id, projectIds: [projectId], blob: new Blob([bytes], { type: info.type }), addedAt: Date.now() });
  await tx.done;
}

export async function removeProjectFile(projectId: string, id: string) {
  const tx = (await getDatabase()).transaction("projectFiles", "readwrite");
  const item = await tx.store.get(id);
  if (item?.projectIds.includes(projectId)) {
    const projectIds = item.projectIds.filter(project => project !== projectId);
    if (projectIds.length) await tx.store.put({ ...item, projectIds });
    else await tx.store.delete(id);
  }
  await tx.done;
}

export async function saveProjectSticky(projectId: string, note: ProjectSticky, remove = false) {
  const tx = (await getDatabase()).transaction(["projectDesks", "canvases", "focusSessions"], "readwrite");
  const available = await isProjectAvailable(tx.objectStore("canvases"), tx.objectStore("focusSessions"), projectId);
  if (!available) { await tx.done; throw new Error("Project unavailable"); }
  const store = tx.objectStore("projectDesks");
  const desk = await store.get(projectId) ?? emptyDesk(projectId);
  const text = note.text.trim();
  if (!remove && (!text || text.length > 2000)) { await tx.done; throw new Error("Note is empty or too long"); }
  const next = desk.notes.filter(item => item.id !== note.id);
  if (!remove) {
    const saved: ProjectSticky = { ...note, text, updatedAt: Date.now() };
    next.unshift(saved);
  }
  next.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt);
  await store.put({ ...desk, notes: next });
  await tx.done;
}

export async function setAutomaticProjectFiles(projectId: string, conversationId: string, enabled: boolean) {
  if (!conversationId) return;
  const tx = (await getDatabase()).transaction(["projectDesks", "canvases", "focusSessions"], "readwrite");
  const available = await isProjectAvailable(tx.objectStore("canvases"), tx.objectStore("focusSessions"), projectId);
  if (!available) { await tx.done; throw new Error("Project unavailable"); }
  const store = tx.objectStore("projectDesks");
  const desks = await store.getAll();
  const desk = desks.find(item => item.id === projectId) ?? emptyDesk(projectId);
  if (enabled) for (const other of desks) {
    if (other.id !== projectId && other.autoChats.includes(conversationId)) await store.put({ ...other, autoChats: other.autoChats.filter(id => id !== conversationId) });
  }
  await store.put({ ...desk, autoChats: [...new Set(enabled ? [...desk.autoChats, conversationId] : desk.autoChats.filter(id => id !== conversationId))] });
  await tx.done;
}

export async function uploadProjects(conversationId: string) {
  if (!conversationId) return [];
  const db = await getDatabase();
  const tx = db.transaction(["projectDesks", "canvases", "focusSessions"], "readonly");
  const [desks, canvases, sessions] = await Promise.all([tx.objectStore("projectDesks").getAll(), tx.objectStore("canvases").getAll(), tx.objectStore("focusSessions").getAll()]);
  const automatic = new Set(desks.filter(item => item.autoChats.includes(conversationId)).map(item => item.id));
  const canvasById = new Map(canvases.map(canvas => [canvas.id, canvas]));
  const newest = new Map(sessions.filter(isLiveWorkSession)
    .sort((a, b) => a.createdAt - b.createdAt || a.updatedAt - b.updatedAt)
    .map(item => [projectIdentity(item), item]));
  const result: Array<{ id: string; name: string; auto: boolean }> = [];
  for (const [id, session] of newest) {
    const canvas = session.canvasId ? canvasById.get(session.canvasId) : undefined;
    if (session.canvasId && (!canvas || isDeletedProject(canvas))) continue;
    const auto = automatic.has(id);
    if (auto || session.sourceConversationIds.includes(conversationId) || session.sidecarConversationIds?.includes(conversationId)) {
      result.push({ id, name: canvas?.name || session.title, auto });
    }
  }
  return result;
}

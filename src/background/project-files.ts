import type { AtlasMessage } from "../shared/messages";
import { handoffPageMatches } from "../shared/handoff-page";
import { projectIdentity } from "../shared/project-continuation";
import { AUTO_FILE_LIMIT, decodeProjectChunk, encodeProjectChunk, PROJECT_FILE_CHUNK, PROJECT_FILE_LIMIT, supportedProjectFile, type ProjectFileAttachResult, type ProjectFileInfo } from "../shared/project-files";
import { getDatabase } from "../storage/db";
import { isDeletedProject } from "../storage/project-deletion";
import { saveProjectFile, uploadProjects } from "../storage/project-desk";

type FileRequest = Extract<AtlasMessage, {
  type: "ATLAS_PROJECT_FILE_CONTEXT" | "ATLAS_PROJECT_FILE_START" | "ATLAS_PROJECT_FILE_CHUNK" |
    "ATLAS_PROJECT_FILE_FINISH" | "ATLAS_PROJECT_FILE_REUSE" | "ATLAS_PROJECT_FILE_DROP";
}>;
interface Page { tabId: number; conversationId: string }
type Expiration = ReturnType<typeof setTimeout>;
const incoming = new Map<string, Page & { projectId: string; info: ProjectFileInfo; manual: boolean; bytes: Uint8Array<ArrayBuffer>; offset: number; documentId?: string; expiration: Expiration }>();
const drags = new Map<string, Page & { projectId: string; fileId: string; expiration: Expiration }>();

async function pageMatches(page: Page) {
  const tab = await chrome.tabs.get(page.tabId);
  if (!handoffPageMatches(tab.url, page.conversationId)) throw new Error("Chat changed");
  return tab;
}

async function reusableFile(projectId: string, fileId: string) {
  const db = await getDatabase();
  const [file, canvas] = await Promise.all([db.get("projectFiles", fileId), db.get("canvases", projectId)]);
  if (!file?.projectIds.includes(projectId)) return undefined;
  if (canvas) return !isDeletedProject(canvas) ? file : undefined;
  const sessions = await db.getAll("focusSessions");
  const live = sessions.find(item => item.mode === "work" && item.status !== "preview" && !item.deletedAt && !item.ledgerTest && projectIdentity(item) === projectId);
  if (!live) return undefined;
  if (live.canvasId) {
    const owned = await db.get("canvases", live.canvasId);
    if (!owned || isDeletedProject(owned)) return undefined;
  }
  return file;
}

async function reuseFile(page: Page, projectId: string, fileId: string, token = crypto.randomUUID() as string): Promise<ProjectFileAttachResult> {
  if (!(await pageMatches(page).catch(() => undefined))?.active) return { ok: false, reason: "chat-changed" };
  const file = await reusableFile(projectId, fileId);
  if (!file) return { ok: false, reason: "transfer-failed" };
  const { name, type, size } = file;
  for (let offset = 0; offset < size; offset += PROJECT_FILE_CHUNK) {
    const chunk = new Uint8Array(await file.blob.slice(offset, offset + PROJECT_FILE_CHUNK).arrayBuffer());
    const result = await chrome.tabs.sendMessage(page.tabId, {
      type: "ATLAS_PROJECT_FILE_RECEIVE", conversationId: page.conversationId, token, offset,
      data: encodeProjectChunk(chunk), ...(offset === 0 ? { info: { name, type, size } } : {}),
    } satisfies AtlasMessage, { frameId: 0 }).catch(() => ({ ok: false, reason: "page-unavailable" } as const)) as ProjectFileAttachResult | undefined;
    if (!result) return { ok: false, reason: "page-unavailable" };
    if (!result.ok) return result;
  }
  return { ok: true };
}

export async function handleProjectFile(message: FileRequest, sender: chrome.runtime.MessageSender) {
  if (message.type === "ATLAS_PROJECT_FILE_REUSE") {
    const tabId = message.tabId;
    const sidebar = sender.url && new URL(sender.url);
    if (tabId === undefined || !sidebar || `${sidebar.protocol}//${sidebar.host}${sidebar.pathname}` !== chrome.runtime.getURL("sidecar.html") ||
      sidebar.searchParams.get("native") !== "1" || sidebar.searchParams.has("tabId") && sidebar.searchParams.get("tabId") !== String(tabId)) return { ok: false, reason: "chat-changed" };
    const page = { tabId, conversationId: message.conversationId };
    if (message.token) {
      if (!/^[\da-f-]{36}$/iu.test(message.token)) return { ok: false, reason: "transfer-failed" };
      const token = message.token;
      const expiration = setTimeout(() => drags.delete(token), 60_000);
      drags.set(token, { ...page, projectId: message.projectId, fileId: message.fileId, expiration });
      const file = await reusableFile(message.projectId, message.fileId);
      if (!file || !(await pageMatches(page).catch(() => undefined))?.active) return { ok: false, reason: "chat-changed" };
      const { name, type, size } = file;
      return chrome.tabs.sendMessage(tabId, {
        type: "ATLAS_PROJECT_FILE_DRAG_READY", conversationId: page.conversationId, token, info: { name, type, size },
      } satisfies AtlasMessage, { frameId: 0 }).catch(() => ({ ok: false, reason: "page-unavailable" }));
    }
    return reuseFile(page, message.projectId, message.fileId);
  }

  const tabId = sender.tab?.id;
  if (tabId === undefined || sender.frameId !== 0) return { ok: false };
  if (message.type === "ATLAS_PROJECT_FILE_CHUNK" || message.type === "ATLAS_PROJECT_FILE_FINISH") {
    const active = incoming.get(message.token);
    if (!active || active.tabId !== tabId || active.documentId !== sender.documentId) return { ok: false };
    if (message.type === "ATLAS_PROJECT_FILE_CHUNK") {
      const chunk = decodeProjectChunk(message.data);
      if (!chunk.length || active.offset !== message.offset || active.offset + chunk.length > active.bytes.length) return { ok: false };
      active.bytes.set(chunk, active.offset);
      active.offset += chunk.length;
      return { ok: true };
    }
    incoming.delete(message.token);
    clearTimeout(active.expiration);
    await pageMatches(active);
    const allowed = (await uploadProjects(active.conversationId)).some(item => item.id === active.projectId && (active.manual || item.auto));
    if (!allowed || active.offset !== active.info.size) return { ok: false };
    await saveProjectFile(active.projectId, active.info, active.bytes.buffer, active.manual);
    void chrome.runtime.sendMessage({ type: "ATLAS_PROJECT_FILES_CHANGED", projectId: active.projectId } satisfies AtlasMessage).catch(() => undefined);
    return { ok: true };
  }

  const page = { tabId, conversationId: message.conversationId };
  if (message.type === "ATLAS_PROJECT_FILE_DROP") {
    const drag = drags.get(message.token);
    if (!drag || drag.tabId !== tabId || drag.conversationId !== page.conversationId) return { ok: false, reason: "drag-expired" };
    drags.delete(message.token);
    clearTimeout(drag.expiration);
    return reuseFile(page, drag.projectId, drag.fileId, message.token);
  }
  await pageMatches(page);
  const projects = await uploadProjects(page.conversationId);
  if (message.type === "ATLAS_PROJECT_FILE_CONTEXT") return { ok: true, projects };
  const { info, manual, projectId } = message;
  if (!info || !supportedProjectFile(info) || info.size > (manual ? PROJECT_FILE_LIMIT : AUTO_FILE_LIMIT) ||
    !projects.some(item => item.id === projectId && (manual || item.auto)) || incoming.size >= 4) return { ok: false };
  const token = crypto.randomUUID();
  const expiration = setTimeout(() => incoming.delete(token), 120_000);
  incoming.set(token, { ...page, projectId, info, manual, bytes: new Uint8Array(info.size), offset: 0, documentId: sender.documentId, expiration });
  return { ok: true, token };
}

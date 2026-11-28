import type { FocusSection, FocusSession } from "../shared/focus-session";
import type { WikiWritingMode } from "../shared/wiki-knowledge";
import { sameProject } from "../shared/project-continuation";
import { notifyProjectChange } from "../shared/project-change-notification";
import { getDatabase } from "./db";
import { deleteProject, isDeletedProject } from "./project-deletion";

export function sidecarProjectHead(sessions: FocusSession[], project: FocusSession) {
  return sessions.filter(item => item.mode === "work" && sameProject(item, project) && !item.deletedAt && !item.ledgerTest && item.status !== "preview")
    .sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt)[0];
}

export async function trashSidecarProject(project: FocusSession) {
  if (project.canvasId) return deleteProject(project.canvasId);
  const tx = (await getDatabase()).transaction("focusSessions", "readwrite");
  const versions = await tx.store.getAll();
  const deletedAt = Date.now();
  await Promise.all(versions.filter(version => !version.canvasId && sameProject(version, project)
    && version.mode === "work" && !version.deletedAt && !version.ledgerTest)
    .map(version => tx.store.put({ ...version, deletedAt })));
  await tx.done;
  notifyProjectChange({type:"ATLAS_PROJECT_TRASHED", projectId:project.rootSessionId ?? project.id});
}

async function changeSidecarProject(project: FocusSession, zh: boolean, change: (current: FocusSession) => FocusSession) {
  const db = await getDatabase();
  const tx = db.transaction(["focusSessions", "canvases"], "readwrite");
  const sessions = tx.objectStore("focusSessions");
  try {
    const [all, canvas] = await Promise.all([sessions.getAll(), project.canvasId ? tx.objectStore("canvases").get(project.canvasId) : undefined]);
    const current = sidecarProjectHead(all, project);
    if (!current || current.id !== project.id || project.canvasId && (!canvas || isDeletedProject(canvas))) {
      throw new Error(zh ? "项目版本已变化。请复制草稿并打开最新版。" : "The project version changed. Copy your draft and reopen the latest version.");
    }
    const saved = change(current);
    if (saved !== current) await sessions.put(saved);
    await tx.done;
    if (saved !== current) notifyProjectChange({type:"ATLAS_PROJECT_VERSION_SAVED"});
    return saved;
  } catch (error) {
    await tx.done.catch(() => undefined);
    throw error;
  }
}

export function setSidecarWritingMode(project: FocusSession, mode: WikiWritingMode, zh: boolean) {
  return changeSidecarProject(project, zh, current => current.sidecarWritingMode === mode ? current : { ...current, sidecarWritingMode: mode });
}

export function saveManualWikiChapter(project: FocusSession, chapter: FocusSection | undefined, title: string, body: string, zh: boolean) {
  return changeSidecarProject(project, zh, current => {
    const existing = chapter && current.sections.find(section => section.id === chapter.id);
    if (chapter && (!existing || existing.title !== chapter.title || existing.body !== chapter.body || existing.wikiDisplayTitle !== chapter.wikiDisplayTitle)) {
      throw new Error(zh ? "本章已被修改。请复制草稿并打开最新版。" : "The chapter changed. Copy your draft and reopen the latest version.");
    }
    const now = Math.max(Date.now(), current.updatedAt + 1, current.createdAt + 1);
    const name = title.trim();
    if (!name) throw new Error(zh ? "请输入章节标题。" : "Enter a section title.");
    const updated: FocusSection = existing
      ? { ...existing, title: name, wikiDisplayTitle: existing.wikiDisplayTitle && name !== existing.title ? name : existing.wikiDisplayTitle, body, userEdited: true }
      : { id: crypto.randomUUID(), title: name, body, transition: "", evidenceIds: [], kind: "finding", origin: "user", userEdited: true };
    const sections = existing ? current.sections.map(section => section.id === existing.id ? updated : section) : [...current.sections, updated];
    return { ...current, id: crypto.randomUUID(), rootSessionId: current.rootSessionId ?? current.id, previousSessionId: current.id,
      createdAt: now, updatedAt: now, sections, activeSectionId: updated.id, wikiOverview: undefined, continuationUpdate: undefined };
  });
}

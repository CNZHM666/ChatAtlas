import type { AtlasCanvas } from "../shared/types";
import { OVERVIEW_CANVAS_ID } from "../shared/constants";
import { getDatabase } from "./db";

type StoredProject = AtlasCanvas & { deletedAt?: number };
export const isDeletedProject = (project: AtlasCanvas) => typeof (project as StoredProject).deletedAt === "number";

export async function listDeletedProjects(): Promise<AtlasCanvas[]> {
  return (await (await getDatabase()).getAll("canvases")).filter(isDeletedProject)
    .sort((a, b) => (b as StoredProject).deletedAt! - (a as StoredProject).deletedAt!);
}

/** Keep project contents and shared source material recoverable; hide all its saved versions. */
export async function deleteProject(id: string): Promise<void> {
  const db = await getDatabase(), project = await db.get("canvases", id);
  if (!project || id === OVERVIEW_CANVAS_ID || project.type === "overview") throw new Error("无法删除工作台首页。");
  await db.put("canvases", { ...project, deletedAt: Date.now() } as StoredProject);
}

export async function restoreProject(id: string): Promise<void> {
  const db = await getDatabase(), project = await db.get("canvases", id) as StoredProject | undefined;
  if (!project || !isDeletedProject(project)) return;
  const restored = { ...project };
  delete restored.deletedAt;
  await db.put("canvases", restored);
}

/** Permanently remove only trashed projects/versions. Shared originals and cards
 * used by surviving projects remain; all removals commit together. */
export async function emptyProjectTrash(): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(["canvases", "focusSessions", "canvasMemberships", "knowledgeCards", "knowledgeRelations", "sourceRelations", "cards", "edges", "viewports", "readingProgress", "reviewMarks", "projectQueryThreads", "projectHistoryTasks", "focusGenerationTasks", "homeResults"], "readwrite");
  const projects = (await tx.objectStore("canvases").getAll()).filter(item => item.id !== OVERVIEW_CANVAS_ID && item.type !== "overview" && isDeletedProject(item));
  const projectIds = new Set(projects.map(item => item.id));
  const sessions = await tx.objectStore("focusSessions").getAll();
  const removed = sessions.filter(item => item.deletedAt || item.canvasId && projectIds.has(item.canvasId));
  const sessionIds = new Set(removed.map(item => item.id));
  const removedRoots = new Set(removed.map(item => item.rootSessionId ?? item.id));
  const keptRoots = new Set(sessions.filter(item => !sessionIds.has(item.id)).map(item => item.rootSessionId ?? item.id));
  for (const id of projectIds) await tx.objectStore("canvases").delete(id);
  for (const id of sessionIds) {
    await tx.objectStore("focusSessions").delete(id);
    for (const kind of ["history", "evolution"]) await tx.objectStore("projectHistoryTasks").delete(`${kind}:${id}`);
  }
  const memberships = await tx.objectStore("canvasMemberships").getAll();
  const touchedCards = new Set(memberships.filter(item => projectIds.has(item.canvasId)).map(item => item.cardId));
  for (const item of memberships) if (projectIds.has(item.canvasId)) await tx.objectStore("canvasMemberships").delete(item.id);
  const deletedCards = new Set<string>();
  for (const card of await tx.objectStore("knowledgeCards").getAll()) {
    if (!touchedCards.has(card.id) && !(card.homeCanvasId && projectIds.has(card.homeCanvasId))) continue;
    const surviving = memberships.find(item => item.cardId === card.id && !projectIds.has(item.canvasId));
    if (surviving) {
      if (card.homeCanvasId && projectIds.has(card.homeCanvasId)) await tx.objectStore("knowledgeCards").put({ ...card, homeCanvasId: surviving.canvasId });
    } else { deletedCards.add(card.id); await tx.objectStore("knowledgeCards").delete(card.id); }
  }
  for (const relation of await tx.objectStore("knowledgeRelations").getAll()) if (deletedCards.has(relation.fromCardId) || deletedCards.has(relation.toCardId)) await tx.objectStore("knowledgeRelations").delete(relation.id);
  for (const relation of await tx.objectStore("sourceRelations").getAll()) if (deletedCards.has(relation.cardId)) await tx.objectStore("sourceRelations").delete(relation.id);
  for (const name of ["cards", "edges", "viewports", "readingProgress", "reviewMarks"] as const) {
    for (const item of await tx.objectStore(name).getAll()) if (projectIds.has(item.canvasId)) await tx.objectStore(name).delete(item.id);
  }
  for (const thread of await tx.objectStore("projectQueryThreads").getAll()) {
    if (thread.id.startsWith("project:") && projectIds.has(thread.id.slice(8)) || thread.id.startsWith("result:") && removedRoots.has(thread.id.slice(7)) && !keptRoots.has(thread.id.slice(7))) await tx.objectStore("projectQueryThreads").delete(thread.id);
  }
  for (const task of await tx.objectStore("focusGenerationTasks").getAll()) if (task.sessionId && sessionIds.has(task.sessionId) || task.scopeCanvasId && projectIds.has(task.scopeCanvasId)) await tx.objectStore("focusGenerationTasks").delete(task.id);
  for (const record of await tx.objectStore("homeResults").getAll()) if ("answer" in record && (sessionIds.has(record.answer.id) || record.answer.canvasId && projectIds.has(record.answer.canvasId))) await tx.objectStore("homeResults").delete(record.id);
  await tx.done;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("atlas-focus-tasks-changed"));
}

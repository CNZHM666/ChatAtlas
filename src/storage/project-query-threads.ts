import type { FocusSession } from "../shared/focus-session";
import { getDatabase } from "./db";

export interface ProjectQueryTurn {
  id: string; question: string; answer?: FocusSession; clarification?: string; revision: string; createdAt: number;
  chapters: Array<{ id: string; title: string; sessionId?: string; sectionId?: string }>;
  saved?: "note" | "card";
}
export interface ProjectQueryThread { id: string; turns: ProjectQueryTurn[]; updatedAt: number }
export const projectQueryThreadId = (session: FocusSession) => session.canvasId ? `project:${session.canvasId}` : `result:${session.rootSessionId ?? session.id}`;
export async function readProjectQueryThread(id: string): Promise<ProjectQueryTurn[]> { return (await (await getDatabase()).get("projectQueryThreads", id))?.turns ?? []; }
export async function saveProjectQueryTurn(id: string, turn: ProjectQueryTurn): Promise<void> {
  const db = await getDatabase(), tx = db.transaction("projectQueryThreads", "readwrite");
  const previous = await tx.store.get(id);
  // Upsert only this turn so local note saves or other tabs cannot erase history.
  const turns = [...(previous?.turns ?? []).filter(item => item.id !== turn.id), turn].sort((a, b) => a.createdAt - b.createdAt).slice(-50);
  await tx.store.put({ id, turns, updatedAt: Date.now() }); await tx.done;
}

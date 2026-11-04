import { listDeletedProjects } from "./project-deletion";
import type { FocusSession } from "../shared/focus-session";
import { projectQueryThreadId } from "./project-query-threads";
import { getDatabase } from "./db";
import {focusTaskResult} from "../shared/focus-task-result";

export async function listFocusSessions(): Promise<FocusSession[]> {
  const deleted = new Set((await listDeletedProjects()).map(project => project.id));
  return (await (await getDatabase()).getAllFromIndex("focusSessions", "by-updated")).reverse().filter(session => !session.deletedAt && !session.ledgerTest && (!session.canvasId || !deleted.has(session.canvasId)));
}

/** Developer ledger tests, newest first: sessions made only to read their conversations into a ledger. */
export async function listLedgerTestSessions(): Promise<FocusSession[]> {
  return (await (await getDatabase()).getAllFromIndex("focusSessions", "by-updated")).reverse().filter(session => session.ledgerTest);
}

/** A ledger test removed for good: it holds no document or user writing, only a ledger made for testing. */
export async function deleteLedgerTestSession(id: string): Promise<void> {
  const db = await getDatabase(), session = await db.get("focusSessions", id);
  if (session?.ledgerTest) await db.delete("focusSessions", id);
}
/** Deleted versions of projects that still exist, newest deletion first. */
export async function listDeletedFocusSessions(): Promise<FocusSession[]> {
  const deleted = new Set((await listDeletedProjects()).map(project => project.id));
  return (await (await getDatabase()).getAll("focusSessions")).filter(session => session.deletedAt && !session.ledgerTest && !(session.canvasId && deleted.has(session.canvasId))).sort((a, b) => b.deletedAt! - a.deletedAt!);
}

/** One version leaves the project's version list; its text, notes and sources are kept for restoring. */
export async function setFocusSessionDeleted(id: string, deleted: boolean): Promise<void> {
  const db = await getDatabase(), session = await db.get("focusSessions", id);
  if (!session) return;
  const next = { ...session };
  if (deleted) next.deletedAt = Date.now(); else delete next.deletedAt;
  await db.put("focusSessions", next);
}

export async function saveFocusSession(session: FocusSession): Promise<void> {
  const db = await getDatabase();
  const tx=db.transaction(["focusSessions","focusGenerationTasks"],"readwrite");
  const previous = await tx.objectStore("focusSessions").get(session.id);
  if (previous?.historyHiddenAt) session = { ...session, historyHiddenAt: previous.historyHiddenAt };
  await tx.objectStore("focusSessions").put(session);
  let tasksChanged=false;
  for(const task of await tx.objectStore("focusGenerationTasks").getAll())if(focusTaskResult(task,[session])&&(task.status!=="preview"||task.sessionId!==session.id)){
    await tx.objectStore("focusGenerationTasks").put({...task,status:"preview",sessionId:session.id,errorCode:undefined,updatedAt:Date.now()});
    tasksChanged=true;
  }
  await tx.done;
  if(tasksChanged&&typeof window!=="undefined")window.dispatchEvent(new Event("atlas-focus-tasks-changed"));
  if (session.status !== "preview" && JSON.stringify([previous?.sourceSignatures, previous?.scope]) !== JSON.stringify([session.sourceSignatures, session.scope])) void import("../search/semantic-index").then(module => module.refreshProjectVectors(session)).catch(() => undefined);
}

/** Attach the result and its explicitly confirmed sources together. */
export async function attachFocusSession(session: FocusSession, target: { canvasId: string } | { name: string }): Promise<FocusSession> {
  if (session.status === "preview") throw new Error("请先保存并查看预览 / Save and view the preview first.");
  const db = await getDatabase();
  const tx = db.transaction(["canvases", "focusSessions", "canvasMemberships", "sourceRelations", "knowledgeCards", "cards", "projectQueryThreads"], "readwrite");
  const now = Date.now();
  const canvas = "canvasId" in target ? await tx.objectStore("canvases").get(target.canvasId) : {
    id: crypto.randomUUID(), name: target.name.trim(), title: target.name.trim(), type: "topic" as const,
    origin: "user" as const, intent: session.goal, createdAt: now, updatedAt: now,
  };
  if (!canvas || canvas.type === "overview" || !canvas.name.trim()) {
    void tx.done.catch(() => undefined); tx.abort(); throw new Error("Choose a valid Knowledge Space.");
  }
  const existingSources = new Set(canvas.sourceConversationIds ?? []);
  if (!canvas.sourceConversationIds) {
    // Legacy spaces did not persist an explicit scope. Preserve every linked source.
    const memberships = await tx.objectStore("canvasMemberships").index("by-canvas").getAll(canvas.id);
    for (const membership of memberships) {
      const card = await tx.objectStore("knowledgeCards").get(membership.cardId);
      for (const ref of card?.evidenceRefs ?? []) existingSources.add(ref.conversationId);
      for (const source of await tx.objectStore("sourceRelations").index("by-card").getAll(membership.cardId)) existingSources.add(source.conversationId);
    }
    for (const card of await tx.objectStore("cards").getAll()) if (card.canvasId === canvas.id) for (const id of card.conversationIds) existingSources.add(id);
  }
  await tx.objectStore("canvases").put({ ...canvas, sourceConversationIds: [...new Set([...existingSources, ...session.sourceConversationIds])], updatedAt: now });
  const previousSession = await tx.objectStore("focusSessions").get(session.id);
  const saved = { ...session, ...(previousSession?.historyHiddenAt ? { historyHiddenAt: previousSession.historyHiddenAt } : {}), canvasId: canvas.id, updatedAt: now };
  const previousThreadId = projectQueryThreadId(session), nextThreadId = projectQueryThreadId(saved);
  if (previousThreadId !== nextThreadId) {
    const store = tx.objectStore("projectQueryThreads");
    const previous = await store.get(previousThreadId), destination = await store.get(nextThreadId);
    if (previous?.turns.length) {
      const turns = [...new Map([...previous.turns, ...(destination?.turns ?? [])].map(turn => [turn.id, turn])).values()].sort((a, b) => a.createdAt - b.createdAt).slice(-50);
      await store.put({ id: nextThreadId, turns, updatedAt: now });
    }
  }
  await tx.objectStore("focusSessions").put(saved);
  await tx.done;
  void import("../search/semantic-index").then(module => module.refreshProjectVectors(session)).catch(() => undefined);
  return saved;
}

export { focusMarkdown } from "../shared/focus-markdown";

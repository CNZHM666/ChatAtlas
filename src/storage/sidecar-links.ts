import { notifyProjectChange } from "../shared/project-change-notification";
import { getDatabase } from "./db";
import { sidecarProjectHead } from "./sidecar-projects";
import { isDeletedProject } from "./project-deletion";

/** Link metadata only. Never alter the accepted Wiki, evidence, scope or analysis baseline. */
export async function linkSidecarProject(sessionId: string, conversationId: string): Promise<void> {
  return linkConversationsToProject(sessionId, [conversationId]);
}

/** Atomic many-to-many source association; one unavailable source rolls back the whole batch. */
export async function linkConversationsToProject(sessionId: string, conversationIds: string[]): Promise<void> {
  const ids = [...new Set(conversationIds)];
  if (!ids.length) throw new Error("请先选择对话。");
  const db = await getDatabase();
  const tx = db.transaction(["focusSessions", "conversations", "canvases"], "readwrite");
  const sessions = tx.objectStore("focusSessions");
  const requested = await sessions.get(sessionId);
  const session = requested && !requested.deletedAt ? sidecarProjectHead(await sessions.getAll(), requested) : undefined;
  const conversations = await Promise.all(ids.map(id => tx.objectStore("conversations").get(id)));
  const canvas = session?.canvasId ? await tx.objectStore("canvases").get(session.canvasId) : undefined;
  if (!session || session.mode !== "work" || session.status === "preview" || conversations.some(item => !item) || session.canvasId && (!canvas || isDeletedProject(canvas))) {
    tx.abort(); await tx.done.catch(() => undefined); throw new Error("项目或对话已不可用，请重新选择。");
  }
  const pending = ids.filter(id => !session.sourceConversationIds.includes(id) && !session.sidecarConversationIds?.includes(id));
  if (pending.length) await sessions.put({ ...session, sidecarConversationIds: [...(session.sidecarConversationIds ?? []), ...pending] });
  const canvasChanged = canvas && ids.some(id => !canvas.sourceConversationIds?.includes(id));
  if (canvasChanged) await tx.objectStore("canvases").put({ ...canvas, sourceConversationIds: [...new Set([...(canvas.sourceConversationIds ?? session.sourceConversationIds), ...ids])] });
  await tx.done;
  if (pending.length || canvasChanged) notifyProjectChange({type:"ATLAS_PROJECT_VERSION_SAVED"});
}

/** Undo a link not yet organized into the project: a conversation linked by mistake leaves it as if never linked. One the
 * project's knowledge already includes stays; it leaves through the project's own source changes, which re-check the Wiki.
 * Returns false when there was nothing to undo here. */
export async function unlinkSidecarProject(sessionId: string, conversationId: string): Promise<boolean> {
  const db = await getDatabase();
  const tx = db.transaction(["focusSessions", "canvases"], "readwrite");
  const sessions = tx.objectStore("focusSessions");
  const requested = await sessions.get(sessionId);
  const session = requested && !requested.deletedAt ? sidecarProjectHead(await sessions.getAll(), requested) : undefined;
  if (!session || session.sourceConversationIds.includes(conversationId) || !session.sidecarConversationIds?.includes(conversationId)) { tx.abort(); await tx.done.catch(() => undefined); return false; }
  const canvas = session.canvasId ? await tx.objectStore("canvases").get(session.canvasId) : undefined;
  if (session.canvasId && (!canvas || isDeletedProject(canvas))) { await tx.done; return false; }
  await sessions.put({ ...session, sidecarConversationIds: session.sidecarConversationIds.filter(id => id !== conversationId) });
  if (canvas?.sourceConversationIds?.includes(conversationId)) await tx.objectStore("canvases").put({ ...canvas, sourceConversationIds: canvas.sourceConversationIds.filter(id => id !== conversationId) });
  await tx.done;
  notifyProjectChange({type:"ATLAS_PROJECT_VERSION_SAVED"});
  return true;
}

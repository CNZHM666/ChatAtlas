import { getDatabase } from "./db";
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
  const session = await tx.objectStore("focusSessions").get(sessionId);
  const conversations = await Promise.all(ids.map(id => tx.objectStore("conversations").get(id)));
  const canvas = session?.canvasId ? await tx.objectStore("canvases").get(session.canvasId) : undefined;
  if (!session || session.mode !== "work" || session.status === "preview" || conversations.some(item => !item) || session.canvasId && (!canvas || isDeletedProject(canvas))) {
    tx.abort(); await tx.done.catch(() => undefined); throw new Error("项目或对话已不可用，请重新选择。");
  }
  const pending = ids.filter(id => !session.sourceConversationIds.includes(id));
  if (pending.length) await tx.objectStore("focusSessions").put({ ...session, sidecarConversationIds: [...new Set([...(session.sidecarConversationIds ?? []), ...pending])] });
  if (canvas) await tx.objectStore("canvases").put({ ...canvas, sourceConversationIds: [...new Set([...(canvas.sourceConversationIds ?? session.sourceConversationIds), ...ids])] });
  await tx.done;
}

/** Undo a link not yet organized into the project: a conversation linked by mistake leaves it as if never linked. One the
 * project's knowledge already includes stays; it leaves through the project's own source changes, which re-check the Wiki.
 * Returns false when there was nothing to undo here. */
export async function unlinkSidecarProject(sessionId: string, conversationId: string): Promise<boolean> {
  const db = await getDatabase();
  const tx = db.transaction(["focusSessions", "canvases"], "readwrite");
  const session = await tx.objectStore("focusSessions").get(sessionId);
  if (!session || session.sourceConversationIds.includes(conversationId) || !session.sidecarConversationIds?.includes(conversationId)) { tx.abort(); await tx.done.catch(() => undefined); return false; }
  const canvas = session.canvasId ? await tx.objectStore("canvases").get(session.canvasId) : undefined;
  await tx.objectStore("focusSessions").put({ ...session, sidecarConversationIds: session.sidecarConversationIds.filter(id => id !== conversationId) });
  if (canvas?.sourceConversationIds?.includes(conversationId)) await tx.objectStore("canvases").put({ ...canvas, sourceConversationIds: canvas.sourceConversationIds.filter(id => id !== conversationId) });
  await tx.done;
  return true;
}

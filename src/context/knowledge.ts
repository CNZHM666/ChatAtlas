import type { FocusSession } from "../shared/focus-session";
import { getDatabase } from "../storage/db";
import { sourceChange } from "../canvas/source-freshness";
import { sourceMessageSignature } from "../shared/source-signature";
import type { ProjectKnowledge } from "./types";

export const contextProjectSignature = (session?: FocusSession) => session ? sourceMessageSignature(JSON.stringify([
  session.id, session.canvasId, session.title, session.goal, session.scope, session.sourceConversationIds,
  session.sourceSignatures, session.sourceRoles, session.sections, session.brief, session.briefUserEdited,
  session.projectState, session.projectMaintenance, session.projectKnowledge,
  session.projectHistoryAnalysis, session.projectEvolutionAnalysis,
])) : "";

/** Local readonly snapshot. Raw messages remain authoritative; retained versions do not resurrect deletions. */
export async function readProjectKnowledge(session: FocusSession, signal?: AbortSignal, options: { refreshSaved?: boolean } = {}): Promise<ProjectKnowledge> {
  signal?.throwIfAborted();
  const db = await getDatabase(), tx = db.transaction(["messages", "conversations", "focusSessions"], "readonly");
  const storedProject = await tx.objectStore("focusSessions").get(session.id);
  const current = options.refreshSaved && storedProject ? storedProject : session;
  const ids = [...new Set(current.sourceConversationIds)];
  const groups = await Promise.all(ids.map(async id => ({
    conversation: await tx.objectStore("conversations").get(id),
    messages: await tx.objectStore("messages").index("by-conversation").getAll(id),
  })));
  await tx.done; signal?.throwIfAborted();
  if (!options.refreshSaved && storedProject && contextProjectSignature(storedProject) !== contextProjectSignature(session)) throw new Error("项目内容已更新，请更新上下文。编辑稿已保留。 / Project content changed. Refresh the context; your edits are preserved.");
  const conversations = groups.flatMap(group => group.conversation ? [group.conversation] : []);
  const messages = groups.flatMap(group => group.messages);
  const sourcesStale = groups.some((group, index) => {
    const change = sourceChange(current, ids[index], group.messages);
    return !group.conversation || change.unknown || Boolean(change.added || change.changed || change.removed || change.reordered);
  });
  // Include uncited source changes and user maintenance; they can alter the meaning of a retained summary.
  const signature = sourceMessageSignature(JSON.stringify([contextProjectSignature(current), contextProjectSignature(storedProject), conversations.map(item => [item.id, item.title, item.url, item.rawRevision, item.sourceRevision]),
    messages.map(item => [item.id, item.conversationId, item.role, item.messageIndex, item.updatedAt, sourceMessageSignature(item.content), item.uiParts]) ]));
  return { session: structuredClone(current), conversations, messages, sourcesStale, signature };
}

export async function assertProjectKnowledgeCurrent(session: FocusSession, signature: string, zh: boolean): Promise<void> {
  if ((await readProjectKnowledge(session)).signature !== signature) throw new Error(zh ? "项目或来源已变化，请更新上下文。编辑稿已保留。" : "Project or sources changed. Update the context; your edits are preserved.");
}

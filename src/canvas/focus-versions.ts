import type { FocusSession } from "../shared/focus-session";

export interface FocusVersionGroup { id: string; latest: FocusSession; versions: FocusSession[] }

/** Saved projects own their versions by space; unattached results use the same
 * lineage/scope grouping as Workbench history. Include a just-created result
 * before the parent's session list has refreshed, without inventing versions. */
export function workspaceFocusVersions(sessions:FocusSession[],current:FocusSession):FocusSession[]{
 const available=[current,...sessions.filter(session=>session.id!==current.id)].filter(session=>!session.deletedAt);
 if(current.canvasId)return available.filter(session=>session.canvasId===current.canvasId).sort((a,b)=>b.createdAt-a.createdAt||b.updatedAt-a.updatedAt);
 return groupFocusVersions(available.filter(session=>!session.canvasId)).find(group=>group.versions.some(session=>session.id===current.id))?.versions??[];
}

/** Legacy versions lack lineage: group the same goal, mode, source scope and space. */
export function groupFocusVersions(sessions: FocusSession[]): FocusVersionGroup[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const legacyKey = (session: FocusSession) => JSON.stringify([session.goal.trim(), session.mode, session.canvasId ?? "", [...session.sourceConversationIds].sort(), session.scope?.kind === "goal" ? session.scope.blocks?.map((block) => [block.conversationId, [...block.messageIds].sort()]).sort() : "all"]);
  const groups = new Map<string, FocusSession[]>();
  for (const session of sessions) {
    const root = session.rootSessionId ? byId.get(session.rootSessionId) : undefined;
    // Root may be stored in another space; the current space owns this saved entry.
    const key = root && root.canvasId === session.canvasId ? legacyKey(root) : session.rootSessionId ? JSON.stringify([session.rootSessionId, session.canvasId ?? ""]) : legacyKey(session);
    const versions = groups.get(key) ?? [];
    versions.push(session); groups.set(key, versions);
  }
  return [...groups.entries()].map(([id, versions]) => {
    versions.sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt);
    return { id, latest: versions[0], versions };
  }).sort((a, b) => Math.max(...b.versions.map((item) => item.updatedAt)) - Math.max(...a.versions.map((item) => item.updatedAt)));
}

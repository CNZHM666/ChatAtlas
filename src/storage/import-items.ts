import type { ImportDiagnostics, ImportFailureCategory, ImportItemState, ImportItemStatus } from "../shared/types";
import { getDatabase } from "./db";

export async function saveImportItem(sessionId: string, conversationId: string, state: ImportItemState, patch: { retryCount?: number; category?: ImportFailureCategory; error?: string; nextRetryAt?: number } = {}): Promise<void> {
  const db = await getDatabase();
  const id = `${sessionId}:${conversationId}`;
  const previous = await db.get("importItems", id);
  await db.put("importItems", {
    id, sessionId, conversationId, state,
    retryCount: patch.retryCount ?? previous?.retryCount ?? 0,
    failureCategory: patch.category,
    error: patch.error,
    nextRetryAt: patch.nextRetryAt,
    updatedAt: Date.now(),
  });
}

/** Persist an inventory page in one transaction instead of one transaction per conversation. */
export async function saveDiscoveredImportItems(sessionId: string, conversations: Array<{ id: string; pending: boolean }>): Promise<void> {
  if (!conversations.length) return;
  const db = await getDatabase();
  const tx = db.transaction("importItems", "readwrite");
  const store = tx.objectStore("importItems");
  const previous = await Promise.all(conversations.map((conversation) => store.get(`${sessionId}:${conversation.id}`)));
  await Promise.all(conversations.map((conversation, index) => store.put({
    id: `${sessionId}:${conversation.id}`,
    sessionId,
    conversationId: conversation.id,
    state: conversation.pending ? "pending" : "persisted",
    retryCount: previous[index]?.retryCount ?? 0,
    updatedAt: Date.now(),
  })));
  await tx.done;
}

export async function listImportItems(sessionId: string): Promise<ImportItemStatus[]> {
  return (await getDatabase()).getAllFromIndex("importItems", "by-session", sessionId);
}

export async function saveImportDiagnostics(diagnostics: ImportDiagnostics): Promise<void> {
  await (await getDatabase()).put("diagnostics", { ...diagnostics, id: "lastImportDiagnostics", updatedAt: Date.now() });
}

export async function getLastImportDiagnostics(): Promise<ImportDiagnostics | undefined> {
  return (await getDatabase()).get("diagnostics", "lastImportDiagnostics");
}

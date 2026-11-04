import type { Conversation, ImportFailureCategory, ImportJob, ImportReconciliationResult, ImportState } from "../shared/types";

export type LibraryDataState = "empty" | "imported" | "partial" | "hydrated";
export type LiveSyncState = "disconnected" | "connected" | "syncing" | "error";

export function classifyImportError(error: unknown): ImportFailureCategory {
  const candidate = error as { category?: ImportFailureCategory; message?: string };
  if (candidate.category && candidate.category !== "unknown") return candidate.category;
  const message = candidate.message ?? String(error);
  if (/401|auth|sign.?in|session/i.test(message)) return "auth";
  if (/403|permission/i.test(message)) return "permission";
  if (/404|not found|deleted/i.test(message)) return "not_found";
  if (/429|rate.?limit/i.test(message)) return "rate_limit";
  if (/bridge|content script|reach the chatgpt page|receiver/i.test(message)) return "bridge_error";
  if (/parse|format|unexpected.*response|normaliz/i.test(message)) return "parse_error";
  if (/indexeddb|database|persist|storage|quota/i.test(message)) return "storage_error";
  if (/network|timeout|fetch|50\d/i.test(message)) return "network";
  return "unknown";
}

export function chooseFinalImportState(input: { discovered: number; hydrated: number; failed: number; pending: number; authFailed?: boolean; unavailable?: boolean }): ImportState {
  if (input.pending > 0) return "syncing";
  if (input.discovered === 0) return input.authFailed ? "auth_required" : input.unavailable ? "unavailable" : "failed";
  if (input.hydrated >= input.discovered) return "completed";
  if (input.authFailed) return "auth_required";
  if (input.hydrated === 0) return "partial";
  const ratio = input.hydrated / input.discovered;
  return ratio >= 0.9 || input.discovered - input.hydrated <= 3 ? "completed_with_warnings" : "partial";
}

export function reconcileSnapshot(discoveredIds: string[], conversations: Conversation[], failedIds: string[], pendingIds: string[], failureCategories: Record<string, ImportFailureCategory> = {}): ImportReconciliationResult {
  const discovered = new Set(discoveredIds);
  const stored = conversations.filter((conversation) => discovered.has(conversation.id));
  const hydratedIds = new Set(stored.filter(isCurrentHydrationComplete).map((conversation) => conversation.id));
  const hydrated = hydratedIds.size;
  const pending = pendingIds.filter((id) => discovered.has(id)).length;
  const failed = failedIds.filter((id) => discovered.has(id) && !hydratedIds.has(id)).length;
  const authFailed = failedIds.some((id) => failureCategories[id] === "auth");
  return { discovered: discovered.size, persisted: stored.length, hydrated, failed, pending, finalState: chooseFinalImportState({ discovered: discovered.size, hydrated, failed, pending, authFailed }) };
}

export function isCurrentHydrationComplete(conversation: Conversation): boolean {
  return (conversation.importState === "complete" || conversation.importState === undefined && conversation.messageCount !== null)
    && (!conversation.hydrationState || conversation.hydrationState === "hydrated")
    && (!conversation.sourceUpdatedAt || !conversation.hydratedSourceUpdatedAt || conversation.hydratedSourceUpdatedAt >= conversation.sourceUpdatedAt);
}

export function deriveLibrarySyncState(conversations: Conversation[], job: ImportJob | null): { libraryDataState: LibraryDataState; liveSyncState: LiveSyncState } {
  const hydrated = conversations.filter(isCurrentHydrationComplete).length;
  const libraryDataState: LibraryDataState = conversations.length === 0 ? "empty" : hydrated === conversations.length ? "hydrated" : hydrated > 0 ? "partial" : "imported";
  const liveSyncState: LiveSyncState = !job || job.status === "idle" || job.status === "paused" ? "disconnected"
    : ["connecting", "discovering", "syncing", "reconciling"].includes(job.status) ? "syncing"
    : ["auth_required", "unavailable", "failed"].includes(job.status) ? "error" : "connected";
  return { libraryDataState, liveSyncState };
}

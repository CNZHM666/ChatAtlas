import type { ImportJob } from "../shared/types";
import { getDatabase } from "./db";

export const HISTORY_JOB_ID = "chatgpt-history" as const;

export async function getImportJob(): Promise<ImportJob | undefined> {
  const stored = await (await getDatabase()).get("importJobs", HISTORY_JOB_ID);
  if (!stored) return undefined;
  const now = stored.updatedAt || Date.now();
  const sessionId = stored.sessionId ?? `migrated-${now}`;
  const legacyStatus = stored.status as string;
  const legacyPhase = stored.phase as string;
  const status: ImportJob["status"] = legacyStatus === "running" ? (legacyPhase === "connecting" ? "connecting" : legacyPhase === "discovering" || legacyPhase === "discovering_conversations" ? "discovering" : "syncing")
    : legacyStatus === "waiting" ? "connecting"
    : legacyStatus === "complete" ? "completed"
    : legacyStatus === "error" ? "failed"
    : stored.status;
  const phase: ImportJob["phase"] = legacyPhase === "reconciling" ? "reconciling" : legacyPhase === "discovering" || legacyPhase === "discovering_conversations" ? "discovering" : legacyPhase === "fetching" || legacyPhase === "syncing" ? "syncing" : "connecting";
  const discoveredIds = stored.discoveredIds ?? [];
  const persistedIds = stored.persistedIds ?? [];
  return {
    ...stored, sessionId, status, phase,
    discoveredIds, persistedIds,
    persisted: stored.persisted ?? stored.completed ?? 0,
    hydrated: stored.hydrated ?? stored.completed ?? 0,
    completed: stored.completed ?? stored.hydrated ?? 0,
    startedAt: stored.startedAt ?? now,
    checkpoint: stored.checkpoint ?? { sessionId, discoveredIds, persistedIds, failedIds: stored.failedIds ?? [], pendingIds: stored.pendingIds ?? [], lastCursor: String(stored.offset ?? 0), startedAt: stored.startedAt ?? now, updatedAt: now },
  };
}

export async function saveImportJob(job: ImportJob): Promise<void> {
  await (await getDatabase()).put("importJobs", { ...job, updatedAt: Date.now() });
}

export async function clearFailedImportTasks(): Promise<ImportJob | undefined> {
  const job = await getImportJob();
  if (!job) return undefined;
  const next = { ...job, failedIds: [], failed: 0, failureReasons: {}, lastError: job.failedIds.length ? undefined : job.lastError };
  await saveImportJob(next);
  return next;
}

import { getDatabase } from "./db";
import { invalidateStoredMessageSearchIndex } from "./messages";
import { invalidateMessageReadCache } from "./message-read-cache";
import { clearDiscussionHighlightCache } from "../sidecar/discussion-highlights";

/** Local knowledge only. Credentials, transient tasks, usage logs and derived indexes stay out. */
export const BACKUP_STORES = [
  "canvases", "cards", "edges", "conversations", "messages", "anchors", "viewports", "conversationGraphs",
  "organizationPlans", "knowledgeCards", "canvasMemberships", "knowledgeRelations", "sourceRelations",
  "semanticProfiles", "questionSnapshots", "readingProgress", "reviewMarks", "focusSessions", "projectQueryThreads", "sourceVersions", "contextFavorites", "discussionHighlights",
] as const;
const RESET_ON_RESTORE = [
  "messageSearchDocuments", "messageSearchManifests", "messageSearchState",
  "transcriptIndexes", "semanticVectors", "semanticDecisionCache", "knowledgeProposals", "knowledgeIndexes",
  "importJobs", "importItems", "diagnostics", "organizationRuns", "analysisDiagnostics", "focusGenerationTasks", "projectHistoryTasks",
] as const;
const keyField = (name: (typeof BACKUP_STORES)[number]) => name === "conversationGraphs" || name === "semanticProfiles" ? "conversationId" : name === "questionSnapshots" ? "questionId" : "id";

export interface AtlasBackup {
  format: "atlas-local-backup";
  version: 1;
  createdAt: string;
  stores: Record<(typeof BACKUP_STORES)[number], Array<Record<string, unknown>>>;
}

export async function createAtlasBackup(): Promise<AtlasBackup> {
  const db = await getDatabase();
  const tx = db.transaction(BACKUP_STORES, "readonly");
  const values = await Promise.all(BACKUP_STORES.map((name) => tx.objectStore(name).getAll()));
  await tx.done;
  return {
    format: "atlas-local-backup", version: 1, createdAt: new Date().toISOString(),
    stores: Object.fromEntries(BACKUP_STORES.map((name, index) => [name, values[index]])) as unknown as AtlasBackup["stores"],
  };
}

export function parseAtlasBackup(text: string): AtlasBackup {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid ChatAtlas backup.");
  const file = parsed as Partial<AtlasBackup>;
  if (file.format !== "atlas-local-backup" || file.version !== 1 || !file.stores || typeof file.stores !== "object") throw new Error("Unsupported ChatAtlas backup.");
  for (const name of BACKUP_STORES) {
    // Version 1 backups created before goal-based reading have no sessions.
    if ((name === "focusSessions" || name === "projectQueryThreads" || name === "sourceVersions" || name === "contextFavorites" || name === "discussionHighlights") && file.stores[name] === undefined) file.stores[name] = [];
    const records = file.stores[name];
    const key = keyField(name);
    if (!Array.isArray(records) || records.some((record) => !record || typeof record !== "object" || typeof record[key] !== "string" || !record[key])) throw new Error(`Invalid ${name} records.`);
    if (new Set(records.map((record) => record[key])).size !== records.length) throw new Error(`Duplicate ${name} records.`);
  }
  return file as AtlasBackup;
}

/** The entire replacement commits together, or IndexedDB rolls every store back. */
export async function restoreAtlasBackup(backup: AtlasBackup): Promise<void> {
  backup = parseAtlasBackup(JSON.stringify(backup));
  const db = await getDatabase();
  const tx = db.transaction([...BACKUP_STORES, ...RESET_ON_RESTORE], "readwrite");
  for (const name of [...BACKUP_STORES, ...RESET_ON_RESTORE]) await tx.objectStore(name).clear();
  for (const name of BACKUP_STORES) for (const record of backup.stores[name]) await tx.objectStore(name).put(record as never);
  await tx.done;
  invalidateStoredMessageSearchIndex();
  invalidateMessageReadCache();
  clearDiscussionHighlightCache();
}

export function downloadAtlasBackup(backup: AtlasBackup): void {
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `atlas-backup-${backup.createdAt.slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

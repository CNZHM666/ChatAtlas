import { getDatabase } from "./db";
import { invalidateStoredMessageSearchIndex } from "./messages";
import { invalidateMessageReadCache } from "./message-read-cache";
import { clearDiscussionHighlightCache } from "../sidecar/discussion-highlights";
import { decodeProjectChunk, encodeProjectChunk, PROJECT_FILE_CHUNK, PROJECT_FILE_LIMIT, supportedProjectFile } from "../shared/project-files";
import type { ProjectFile } from "./project-desk";

/** Local knowledge only. Credentials, transient tasks, usage logs and derived indexes stay out. */
export const BACKUP_STORES = [
  "canvases", "cards", "edges", "conversations", "messages", "imageAssets", "anchors", "viewports", "conversationGraphs",
  "organizationPlans", "knowledgeCards", "canvasMemberships", "knowledgeRelations", "sourceRelations",
  "semanticProfiles", "questionSnapshots", "readingProgress", "reviewMarks", "focusSessions", "projectQueryThreads", "sourceVersions", "contextFavorites", "discussionHighlights", "projectDesks", "projectFiles",
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
  const stores = Object.fromEntries(BACKUP_STORES.map((name, index) => [name, values[index]])) as unknown as AtlasBackup["stores"];
  stores.projectFiles = [];
  for (const { blob, ...file } of values[BACKUP_STORES.indexOf("projectFiles")] as ProjectFile[]) {
    const chunks: string[] = [];
    for (let offset = 0; offset < file.size; offset += PROJECT_FILE_CHUNK)
      chunks.push(encodeProjectChunk(new Uint8Array(await blob.slice(offset, offset + PROJECT_FILE_CHUNK).arrayBuffer())));
    stores.projectFiles.push({ ...file, chunks });
  }
  return {
    format: "atlas-local-backup", version: 1, createdAt: new Date().toISOString(),
    stores,
  };
}

export function parseAtlasBackup(text: string): AtlasBackup {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid ChatAtlas backup.");
  const file = parsed as Partial<AtlasBackup>;
  if (file.format !== "atlas-local-backup" || file.version !== 1 || !file.stores || typeof file.stores !== "object") throw new Error("Unsupported ChatAtlas backup.");
  for (const name of BACKUP_STORES) {
    // Version 1 backups created before goal-based reading have no sessions.
    if ((name === "imageAssets" || name === "focusSessions" || name === "projectQueryThreads" || name === "sourceVersions" || name === "contextFavorites" || name === "discussionHighlights" || name === "projectDesks" || name === "projectFiles") && file.stores[name] === undefined) file.stores[name] = [];
    const records = file.stores[name];
    const key = keyField(name);
    if (!Array.isArray(records) || records.some((record) => !record || typeof record !== "object" || typeof record[key] !== "string" || !record[key])) throw new Error(`Invalid ${name} records.`);
    if (new Set(records.map((record) => record[key])).size !== records.length) throw new Error(`Duplicate ${name} records.`);
  }
  const projects = new Set(file.stores.canvases.map(record => record.id));
  for (const item of file.stores.projectDesks) {
    if (!projects.has(item.id) || !Array.isArray(item.notes) || !item.notes.every(note => note && typeof note.id === "string" &&
        typeof note.text === "string" && note.text.length <= 2000 && typeof note.updatedAt === "number")) throw new Error("Invalid project notes.");
  }
  for (const item of file.stores.projectFiles) {
    if (typeof item.name !== "string" || typeof item.type !== "string" || typeof item.size !== "number" ||
      !supportedProjectFile({ name: item.name, type: item.type, size: item.size }) || item.size > PROJECT_FILE_LIMIT ||
      !Array.isArray(item.projectIds) || !item.projectIds.length || item.projectIds.some(id => !projects.has(id)) ||
      !Array.isArray(item.chunks) || item.chunks.length !== Math.ceil(item.size / PROJECT_FILE_CHUNK) ||
      item.chunks.some(chunk => typeof chunk !== "string" || chunk.length > Math.ceil(PROJECT_FILE_CHUNK / 3) * 4)) throw new Error("Invalid project files.");
  }
  return file as AtlasBackup;
}

/** The entire replacement commits together, or IndexedDB rolls every store back. */
export async function restoreAtlasBackup(backup: AtlasBackup): Promise<void> {
  backup = parseAtlasBackup(JSON.stringify(backup));
  const files: ProjectFile[] = [];
  for (const { chunks, ...metadata } of backup.stores.projectFiles) {
    const file = metadata as unknown as Omit<ProjectFile, "blob">;
    const bytes = new Uint8Array(file.size);
    let offset = 0;
    for (const chunk of chunks as string[]) {
      const decoded = decodeProjectChunk(chunk);
      bytes.set(decoded, offset);
      offset += decoded.length;
    }
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
    if (offset !== file.size || digest !== file.id) throw new Error("Project file data does not match its backup metadata.");
    files.push({ ...file, blob: new Blob([bytes], { type: file.type }) });
  }
  const db = await getDatabase();
  const tx = db.transaction([...BACKUP_STORES, ...RESET_ON_RESTORE], "readwrite");
  for (const name of [...BACKUP_STORES, ...RESET_ON_RESTORE]) await tx.objectStore(name).clear();
  for (const name of BACKUP_STORES) {
    if (name === "projectFiles") continue;
    for (const record of backup.stores[name]) await tx.objectStore(name).put((name === "projectDesks" ? { ...record, autoChats: [] } : record) as never);
  }
  for (const file of files) await tx.objectStore("projectFiles").put(file);
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

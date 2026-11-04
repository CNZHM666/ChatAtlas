import { getConversation } from "../storage/conversations";
import { saveConversationCapture } from "../storage/messages";
import { openExportRecordStream } from "./export-record-stream";
import { importerFor } from "./importers";

export interface ExportImportProgress {
  stage: "reading" | "saving";
  total: number;
  scanned: number;
  added: number;
  updated: number;
  unchanged: number;
  failed: number;
  messages: number;
  failedIds: string[];
  importedIds: string[];
  /** Saved conversations per source platform, for the completion summary. */
  platforms?: Record<string, number>;
}

/** Local-only bulk import for every supported platform. A bad conversation cannot
 * roll back successfully imported siblings. */
export async function importConversationExport(file: File, onProgress?: (progress: ExportImportProgress) => void, localParser = false): Promise<ExportImportProgress> {
  const progress: ExportImportProgress = { stage: "reading", total: 0, scanned: 0, added: 0, updated: 0, unchanged: 0, failed: 0, messages: 0, failedIds: [], importedIds: [], platforms: {} };
  onProgress?.({ ...progress });
  const source = await openExportRecordStream(file, (name) => { progress.failed += 1; progress.failedIds.push(name); }, localParser);
  progress.stage = "saving";
  progress.total = source.total;
  onProgress?.({ ...progress });
  for await (const record of source.records) {
    progress.scanned += 1;
    const raw = record.raw as { id?: unknown } | undefined;
    try {
      const adapter = importerFor(record);
      const item = adapter.describe(record.raw);
      const existing = await getConversation(item.id);
      const knownNewer = Boolean(existing?.sourceUpdatedAt && (!item.sourceUpdatedAt || existing.sourceUpdatedAt > item.sourceUpdatedAt));
      const revision = knownNewer ? undefined : await adapter.revision(record.raw);
      const sameRevision = Boolean(existing && existing.sourceRevision === revision && (!existing.sourceUpdatedAt || existing.sourceUpdatedAt === item.sourceUpdatedAt));
      if (existing?.importState === "complete" && (knownNewer || sameRevision)) {
        progress.unchanged += 1;
      } else {
        const capture = await adapter.normalize(record.raw, revision ?? await adapter.revision(record.raw));
        if (existing?.messageCount && capture.messages.length === 0) throw new Error("Refusing to replace saved messages with an empty export record.");
        await saveConversationCapture(capture, { warmIndex: false });
        if (existing) progress.updated += 1;
        else progress.added += 1;
        progress.messages += capture.messages.length;
      }
      progress.importedIds.push(item.id);
      progress.platforms![item.platform] = (progress.platforms![item.platform] ?? 0) + 1;
    } catch {
      progress.failed += 1;
      progress.failedIds.push(typeof raw?.id === "string" ? raw.id : `entry-${progress.scanned}`);
    }
    if (progress.scanned % 2 === 0) {
      if (progress.scanned % 10 === 0) onProgress?.({ ...progress, failedIds: [...progress.failedIds] });
      // The dedicated import worker already yields through IDB/crypto. Avoid a
      // clamped timer after every two records there; retain it for UI fallback.
      if (!localParser) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  onProgress?.({ ...progress, failedIds: [...progress.failedIds] });
  return progress;
}

/** Former name, kept for existing callers; it now accepts every supported format. */
export const importChatGPTExport = importConversationExport;


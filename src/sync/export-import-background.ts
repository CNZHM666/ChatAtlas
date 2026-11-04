import { invalidateStoredMessageSearchIndex } from "../storage/messages";
import { invalidateReaderMessages } from "../canvas/reader-message-cache";
import type { ExportImportProgress } from "./export-import";

export type ExportWorkerResponse = { type: "progress" | "done"; progress: ExportImportProgress } | { type: "error"; message: string };

/** Parsing, normalization, hashing and IDB serialization all stay off the UI thread. */
export async function importChatGPTExportInBackground(file: File, onProgress?: (progress: ExportImportProgress) => void): Promise<ExportImportProgress> {
  const fallback = async () => (await import("./export-import")).importChatGPTExport(file, onProgress);
  if (typeof Worker === "undefined") return fallback();
  let worker: Worker;
  try { worker = new Worker(new URL("./export-import-worker.ts", import.meta.url), { type: "module" }); }
  catch { return fallback(); }
  return new Promise<ExportImportProgress>((resolve, reject) => {
    let started = false;
    const invalidate = () => { invalidateStoredMessageSearchIndex(); invalidateReaderMessages(); };
    worker.onmessage = (event: MessageEvent<ExportWorkerResponse>) => {
      started = true;
      const message = event.data;
      if (message.type === "error") { invalidate(); worker.terminate(); reject(new Error(message.message)); return; }
      invalidate(); onProgress?.(message.progress);
      if (message.type === "done") { worker.terminate(); resolve(message.progress); }
    };
    worker.onerror = () => {
      worker.terminate(); invalidate();
      // Once writes may have begun, do not silently replay a partially completed import.
      if (started) reject(new Error("Import worker stopped. Saved conversations are retained; import the file again to continue."));
      else void fallback().then(resolve, reject);
    };
    try { worker.postMessage({ file }); }
    catch (error) { worker.terminate(); reject(error); }
  });
}

import type { ImportRecord } from "./importers";
import { readImportRecords } from "./zip-import";

type WorkerRequest = { type: "start"; file: File } | { type: "next" };
type WorkerResponse = { type: "ready"; total: number; errors: Array<{ name: string; message: string }> }
  | { type: "record"; record: ImportRecord }
  | { type: "done" }
  | { type: "error"; message: string };

async function mainThreadRecords(file: File, onEntryError?: (name: string, message: string) => void) {
  const records: ImportRecord[] = [];
  for await (const record of readImportRecords(file, onEntryError)) records.push(record);
  return { total: records.length, records: (async function* () { yield* records; })() };
}

/** Keep ZIP decompression and JSON parsing off the ChatAtlas page's main thread. */
export async function openExportRecordStream(file: File, onEntryError?: (name: string, message: string) => void, localParser = false): Promise<{ total: number; records: AsyncGenerator<ImportRecord> }> {
  if (localParser || typeof Worker === "undefined") return mainThreadRecords(file, onEntryError);
  let worker: Worker;
  try { worker = new Worker(new URL("./export-record-worker.ts", import.meta.url), { type: "module" }); }
  catch { return mainThreadRecords(file, onEntryError); }

  let pending: { resolve: (value: WorkerResponse) => void; reject: (reason: Error) => void } | null = null;
  let workerError: Error | null = null;
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const request = pending;
    pending = null;
    request?.resolve(event.data);
  };
  worker.onerror = () => {
    workerError = new Error("The export parser could not start.");
    const request = pending;
    pending = null;
    request?.reject(workerError);
  };
  const request = (message: WorkerRequest) => new Promise<WorkerResponse>((resolve, reject) => {
    if (workerError) { reject(workerError); return; }
    pending = { resolve, reject };
    try { worker.postMessage(message); }
    catch (error) { pending = null; reject(error instanceof Error ? error : new Error(String(error))); }
  });

  let ready: WorkerResponse;
  try { ready = await request({ type: "start", file }); }
  catch { worker.terminate(); return mainThreadRecords(file, onEntryError); }
  if (ready.type === "error") { worker.terminate(); throw new Error(ready.message); }
  if (ready.type !== "ready") { worker.terminate(); throw new Error("The export parser returned an invalid response."); }
  for (const error of ready.errors) onEntryError?.(error.name, error.message);
  const total = ready.total;
  const records = (async function* () {
    try {
      for (let index = 0; index < total; index += 1) {
        const next = await request({ type: "next" });
        if (next.type === "error") throw new Error(next.message);
        if (next.type !== "record") throw new Error("The export parser stopped before all conversations were read.");
        yield next.record;
      }
    } finally { worker.terminate(); }
  })();
  return { total, records };
}

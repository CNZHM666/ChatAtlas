import type { ImportRecord } from "./importers";
import { openImportRecordSource } from "./zip-import";

type Request = { type: "start"; file: File } | { type: "next" };
type Response = { type: "ready"; total: number; errors: Array<{ name: string; message: string }> }
  | { type: "record"; record: ImportRecord; errors?: Array<{ name: string; message: string }> }
  | { type: "done" }
  | { type: "error"; message: string };

const scope = globalThis as unknown as { postMessage: (message: Response) => void; onmessage: ((event: MessageEvent<Request>) => void) | null };
let records: Array<ImportRecord | undefined> = [];
let nextIndex = 0;
let resolveRecord = async (record: ImportRecord) => record;
let entryErrors: Array<{ name: string; message: string }> = [];

scope.onmessage = (event) => {
  if (event.data.type === "next") {
    const record = records[nextIndex];
    records[nextIndex] = undefined;
    nextIndex += 1;
    if (!record) { scope.postMessage({ type: "done" }); return; }
    const from = entryErrors.length;
    void resolveRecord(record).then(resolved => scope.postMessage({ type: "record", record: resolved, errors: entryErrors.slice(from) })).catch((error: unknown) => scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) }));
    return;
  }
  const file = event.data.file;
  void (async () => {
    try {
      const errors: Array<{ name: string; message: string }> = [];
      entryErrors = errors;
      records = [];
      nextIndex = 0;
      const source = await openImportRecordSource(file, (name, message) => errors.push({ name, message }));
      records = source.records;
      resolveRecord = source.resolve;
      scope.postMessage({ type: "ready", total: records.length, errors });
    } catch (error) {
      scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  })();
};

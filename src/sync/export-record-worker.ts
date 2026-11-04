import type { ImportRecord } from "./importers";
import { readImportRecords } from "./zip-import";

type Request = { type: "start"; file: File } | { type: "next" };
type Response = { type: "ready"; total: number; errors: Array<{ name: string; message: string }> }
  | { type: "record"; record: ImportRecord }
  | { type: "done" }
  | { type: "error"; message: string };

const scope = globalThis as unknown as { postMessage: (message: Response) => void; onmessage: ((event: MessageEvent<Request>) => void) | null };
let records: Array<ImportRecord | undefined> = [];
let nextIndex = 0;

scope.onmessage = (event) => {
  if (event.data.type === "next") {
    const record = records[nextIndex];
    records[nextIndex] = undefined;
    nextIndex += 1;
    scope.postMessage(record ? { type: "record", record } : { type: "done" });
    return;
  }
  const file = event.data.file;
  void (async () => {
    try {
      const errors: Array<{ name: string; message: string }> = [];
      records = [];
      nextIndex = 0;
      for await (const record of readImportRecords(file, (name, message) => errors.push({ name, message }))) records.push(record);
      scope.postMessage({ type: "ready", total: records.length, errors });
    } catch (error) {
      scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  })();
};

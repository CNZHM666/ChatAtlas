import { importConversationExport } from "./export-import";
import type { ExportWorkerResponse } from "./export-import-background";

const scope = globalThis as unknown as { postMessage: (message: ExportWorkerResponse) => void; onmessage: ((event: MessageEvent<{ file: File }>) => void) | null };
scope.onmessage = (event) => {
  let lastUpdate = 0;
  let lastStage = "";
  void importConversationExport(event.data.file, (progress) => {
    const now = Date.now();
    if (progress.stage === lastStage && now - lastUpdate < 1000) return;
    lastStage = progress.stage; lastUpdate = now;
    scope.postMessage({ type: "progress", progress: { ...progress, importedIds: [] } });
  }, true).then((progress) => scope.postMessage({ type: "done", progress }))
    .catch((error: unknown) => scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) }));
};

import { afterEach, describe, expect, it, vi } from "vitest";
import { importChatGPTExportInBackground } from "./export-import-background";
import type { ExportWorkerResponse } from "./export-import-background";
import type { ExportImportProgress } from "./export-import";
const fallback = vi.hoisted(() => vi.fn());
vi.mock("./export-import", () => ({ importChatGPTExport: fallback }));
const progress: ExportImportProgress = { stage: "saving", total: 10, scanned: 5, added: 5, updated: 0, unchanged: 0, failed: 0, messages: 50, failedIds: [], importedIds: [] };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("background file import", () => {
  it("sends the file once and receives bounded progress instead of raw conversation trees", async () => {
    const posts: unknown[] = []; const terminate = vi.fn();
    class FakeWorker {
      onmessage?: (event: MessageEvent<ExportWorkerResponse>) => void;
      onerror?: () => void;
      postMessage(value: unknown) { posts.push(value); queueMicrotask(() => { this.onmessage?.({ data: { type: "progress", progress } } as MessageEvent<ExportWorkerResponse>); this.onmessage?.({ data: { type: "done", progress: { ...progress, scanned: 10, importedIds: ["saved"] } } } as MessageEvent<ExportWorkerResponse>); }); }
      terminate = terminate;
    }
    vi.stubGlobal("Worker", FakeWorker);
    const file = new File(["unparsed"], "conversations.json"); const onProgress = vi.fn();
    expect(await importChatGPTExportInBackground(file, onProgress)).toMatchObject({ importedIds: ["saved"] });
    expect(posts).toEqual([{ file }]); expect(onProgress).toHaveBeenCalledTimes(2); expect(fallback).not.toHaveBeenCalled(); expect(terminate).toHaveBeenCalledOnce();
  });
  it("retains partial imports on worker failure instead of silently restarting writes", async () => {
    class FakeWorker {
      onmessage?: (event: MessageEvent<ExportWorkerResponse>) => void;
      onerror?: () => void;
      postMessage() { queueMicrotask(() => { this.onmessage?.({ data: { type: "progress", progress } } as MessageEvent<ExportWorkerResponse>); this.onerror?.(); }); }
      terminate() {}
    }
    vi.stubGlobal("Worker", FakeWorker);
    await expect(importChatGPTExportInBackground(new File([], "data.json"))).rejects.toThrow("Saved conversations are retained");
    expect(fallback).not.toHaveBeenCalled();
  });
});

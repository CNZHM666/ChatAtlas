import { afterEach, describe, expect, it, vi } from "vitest";
import { openExportRecordStream } from "./export-record-stream";

afterEach(() => vi.unstubAllGlobals());

describe("export parser worker stream", () => {
  it("parses away from the main thread and sends one record only when requested", async () => {
    const requests: string[] = [];
    let terminated = false;
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      private index = 0;
      postMessage(message: { type: string }) {
        requests.push(message.type);
        const data = message.type === "start"
          ? { type: "ready", total: 2, errors: [] }
          : { type: "record", record: { platform: "chatgpt", raw: { id: `conversation-${++this.index}` } } };
        queueMicrotask(() => this.onmessage?.({ data } as MessageEvent));
      }
      terminate() { terminated = true; }
    }
    vi.stubGlobal("Worker", FakeWorker);
    const file = { name: "conversations.json", text: () => { throw new Error("Main-thread parsing should not run"); } } as unknown as File;
    const stream = await openExportRecordStream(file);
    expect(stream.total).toBe(2);
    expect(requests).toEqual(["start"]);
    const iterator = stream.records[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.raw).toEqual({ id: "conversation-1" });
    expect(requests).toEqual(["start", "next"]);
    expect((await iterator.next()).value?.raw).toEqual({ id: "conversation-2" });
    expect((await iterator.next()).done).toBe(true);
    expect(terminated).toBe(true);
  });
});

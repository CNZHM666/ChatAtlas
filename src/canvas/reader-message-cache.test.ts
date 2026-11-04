import { afterEach, expect, it, vi } from "vitest";
import { invalidateReaderMessages, readerMessages } from "./reader-message-cache";
import type { ConversationMessage } from "../shared/types";
const load = vi.hoisted(() => vi.fn());
vi.mock("../storage/messages", () => ({ getMessagesForConversation: load }));
afterEach(() => { invalidateReaderMessages(); load.mockReset(); });
it("shares pending and completed reads until an actual import invalidates them", async () => {
  load.mockResolvedValue([{ content: "Stored discussion", preview: "Stored discussion" }] as ConversationMessage[]);
  const first = readerMessages("a");
  expect(readerMessages("a")).toBe(first);
  await first;
  expect(readerMessages("a")).toBe(first);
  expect(load).toHaveBeenCalledOnce();
  invalidateReaderMessages("a"); await readerMessages("a");
  expect(load).toHaveBeenCalledTimes(2);
});
it("does not remove a fresh cache entry when an invalidated read fails later", async () => {
  let reject!: (cause: Error) => void;
  load.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue([{ content: "Fresh", preview: "Fresh" }] as ConversationMessage[]);
  const stale = readerMessages("a");
  invalidateReaderMessages("a"); const fresh = readerMessages("a");
  reject(new Error("old read")); await expect(stale).rejects.toThrow("old read");
  expect(readerMessages("a")).toBe(fresh);
});
it("does not retain oversized transcripts indefinitely", async () => {
  load.mockResolvedValue([{ content: "a".repeat(8000001), preview: "" }] as ConversationMessage[]);
  await readerMessages("large"); await readerMessages("large");
  expect(load).toHaveBeenCalledTimes(2);
});
it("reads again after hydration instead of reusing an empty result", async () => {
  load.mockResolvedValueOnce([]).mockResolvedValueOnce([{ content: "Synced body", preview: "Synced body" }] as ConversationMessage[]);
  expect(await readerMessages("hydrating")).toEqual([]);
  expect((await readerMessages("hydrating"))[0].content).toBe("Synced body");
  expect(load).toHaveBeenCalledTimes(2);
});

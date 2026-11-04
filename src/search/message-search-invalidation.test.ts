import { expect, it, vi } from "vitest";
import { invalidateMessageSearchReaders, onMessageSearchInvalidation } from "./message-search-invalidation";
import { invalidateStoredMessageSearchIndex } from "../storage/messages";
import { messageFullTextSearch } from "./message-fulltext";

it("notifies loaded readers synchronously and unregisters without importing a search engine", () => {
  const first = vi.fn(), second = vi.fn();
  const removeFirst = onMessageSearchInvalidation(first), removeSecond = onMessageSearchInvalidation(second);
  try {
    invalidateMessageSearchReaders(); expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
    removeFirst(); invalidateMessageSearchReaders(); expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledTimes(2);
  } finally { removeFirst(); removeSecond(); }
});

it("keeps the loaded fulltext singleton invalidated when original storage changes", () => {
  const spy = vi.spyOn(messageFullTextSearch, "invalidate");
  try { invalidateStoredMessageSearchIndex(); expect(spy).toHaveBeenCalledOnce(); }
  finally { spy.mockRestore(); }
});

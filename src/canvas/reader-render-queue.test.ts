import { afterEach, expect, it, vi } from "vitest";
import { queueReaderRender } from "./reader-render-queue";
afterEach(() => vi.useRealTimers());
it("spreads simultaneous intersections over separate tasks and cancels unmounted content", () => {
  vi.useFakeTimers();
  const first = vi.fn(), second = vi.fn(), removed = vi.fn();
  queueReaderRender(first); queueReaderRender(second); const cancel = queueReaderRender(removed);
  cancel();
  vi.advanceTimersByTime(16);
  expect(first).toHaveBeenCalledOnce(); expect(second).not.toHaveBeenCalled();
  vi.advanceTimersByTime(16);
  expect(second).toHaveBeenCalledOnce(); expect(removed).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

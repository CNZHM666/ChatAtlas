import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { respondAsync } from "./async-response";

const activity = vi.fn(async () => ({ os: "win" }));
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal("chrome", { runtime: { getPlatformInfo: activity } }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("replies to synchronous throws and rejected operations instead of leaving the channel open", async () => {
  for (const operation of [() => { throw Error("sync failure"); }, () => Promise.reject(Error("async failure"))]) {
    const reply = vi.fn(); expect(respondAsync(reply, operation)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(reply).toHaveBeenCalledOnce(); expect(reply.mock.calls[0][0]).toMatchObject({ ok: false, error: expect.stringContaining("failure") });
    expect(vi.getTimerCount()).toBe(0);
  }
});
it("keeps only a live operation active and releases every timer after the reply", async () => {
  let finish!: (value: unknown) => void; const reply = vi.fn();
  respondAsync(reply, () => new Promise(resolve => { finish = resolve; }));
  await vi.advanceTimersByTimeAsync(40_000);
  expect(activity).toHaveBeenCalledTimes(2); expect(reply).not.toHaveBeenCalled();
  finish({ ok: true }); await vi.advanceTimersByTimeAsync(0);
  expect(reply).toHaveBeenCalledExactlyOnceWith({ ok: true }); expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000); expect(activity).toHaveBeenCalledTimes(2);
});
it("returns a bounded timeout once and does not report late completion as a second success", async () => {
  let finish!: (value: unknown) => void; const reply = vi.fn();
  respondAsync(reply, () => new Promise(resolve => { finish = resolve; }), 25_000);
  await vi.advanceTimersByTimeAsync(25_000);
  expect(reply).toHaveBeenCalledOnce(); expect(reply.mock.calls[0][0]).toMatchObject({ ok: false, code: "RESPONSE_TIMEOUT" });
  finish({ ok: true }); await vi.advanceTimersByTimeAsync(0);
  expect(reply).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it("cleans up if the caller closes before receiving the reply", async () => {
  const reply = vi.fn(() => { throw Error("caller closed"); });
  respondAsync(reply, async () => ({ ok: true }));
  await vi.advanceTimersByTimeAsync(0); expect(reply).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

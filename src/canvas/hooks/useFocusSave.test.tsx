import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFocusSave } from "./useFocusSave";
import { saveFocusSession } from "../../storage/focus-sessions";
import type { FocusSession } from "../../shared/focus-session";

vi.mock("../../storage/focus-sessions", () => ({ saveFocusSession: vi.fn().mockResolvedValue(undefined) }));
const session = { id: "save-test", notes: "" } as FocusSession;
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe("coalesced Reader saves", () => {
  it("coalesces rapid typing, keeps the latest text and flushes before leaving", async () => {
    vi.useFakeTimers();
    const onSaved = vi.fn();
    const { result, unmount } = renderHook(() => useFocusSave(onSaved, vi.fn()));
    for (const notes of ["a", "ab", "abc"]) act(() => { void result.current.save({ ...session, notes }); });
    expect(saveFocusSession).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(saveFocusSession).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenLastCalledWith({ ...session, notes: "abc" });
    act(() => { void result.current.save({ ...session, notes: "last edit" }); });
    unmount();
    await vi.waitFor(() => expect(saveFocusSession).toHaveBeenCalledTimes(2));
    expect(saveFocusSession).toHaveBeenLastCalledWith({ ...session, notes: "last edit" });
  });
  it("serializes saves and allows recovery after a failed write", async () => {
    vi.mocked(saveFocusSession).mockRejectedValueOnce(new Error("disk"));
    const { result } = renderHook(() => useFocusSave(vi.fn(), vi.fn()));
    await expect(result.current.save(session, true)).rejects.toThrow("disk");
    await expect(result.current.save({ ...session, notes: "recovered" }, true)).resolves.toBeUndefined();
    expect(saveFocusSession).toHaveBeenLastCalledWith({ ...session, notes: "recovered" });
  });
});

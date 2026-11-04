import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportJob } from "../../shared/types";
import { PreferencesProvider } from "../preferences";
import { useImportCommands } from "./useImportCommands";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("background sync commands", () => {
  it("preserves the running job when an explicit failure response arrives for pause",async()=>{
    vi.stubGlobal("chrome",{runtime:{sendMessage:vi.fn().mockResolvedValue({ok:false,error:"storage unavailable"})}});
    const flash=vi.fn();const {result}=renderHook(()=>useImportCommands({flash,refreshConversations:vi.fn()}),{wrapper:PreferencesProvider});
    const current={status:"syncing",pendingIds:["current"]} as ImportJob;
    act(()=>result.current.setImportJob(current));
    await act(()=>result.current.pauseImport());
    expect(result.current.importJob).toEqual(current);expect(flash).toHaveBeenCalledOnce();
  });
  it("deduplicates repeated priority requests and keeps file imports isolated", async () => {
    let release!: (value: unknown) => void;
    const sendMessage = vi.fn(() => new Promise(resolve => { release = resolve; }));
    vi.stubGlobal("chrome", { runtime: { id: "test-extension", sendMessage } });
    const { result } = renderHook(() => useImportCommands({ flash: vi.fn(), refreshConversations: vi.fn() }), { wrapper: PreferencesProvider });
    let first!: Promise<boolean>;
    act(() => { first = result.current.commandHydrate(["a", "a"]); });
    await act(() => result.current.commandHydrate(["a"]));
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith({ type: "ATLAS_IMPORT_SELECT", conversationIds: ["a"] });
    await act(async () => { release({ status: "syncing" }); await first; });
    act(() => { result.current.fileImporting.current = true; result.current.setImportSource("zip"); });
    await act(() => result.current.commandHydrate(["b"]));
    await act(() => result.current.commandImport("titles"));
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(result.current.importSource).toBe("zip");
  });

  it("resumes the full checkpoint rather than replacing a paused import with a title scan", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ status: "syncing", retryScope: "full" });
    vi.stubGlobal("chrome", { runtime: { id: "test-extension", sendMessage } });
    const { result } = renderHook(() => useImportCommands({ flash: vi.fn(), refreshConversations: vi.fn() }), { wrapper: PreferencesProvider });
    act(() => result.current.setImportJob({ status: "paused", retryScope: "full", pendingIds: ["last"] } as ImportJob));
    await act(() => result.current.resumeImport());
    expect(sendMessage).toHaveBeenCalledWith({ type: "ATLAS_IMPORT_START", mode: "full" });
  });
  it("ends a rejected scan instead of leaving first import stuck connecting, and can retry", async () => {
    const sendMessage = vi.fn().mockResolvedValueOnce({ error: "Sign in before scanning" }).mockResolvedValueOnce({ status: "completed", retryScope: "titles" });
    vi.stubGlobal("chrome", { runtime: { id: "test-extension", sendMessage }, tabs: { query: vi.fn().mockResolvedValue([{ id: 1, url: "https://chatgpt.com" }]) } });
    const { result } = renderHook(() => useImportCommands({ flash: vi.fn(), refreshConversations: vi.fn() }), { wrapper: PreferencesProvider });
    await act(() => result.current.commandImport("titles"));
    expect(result.current.importJob).toMatchObject({ status: "failed", lastError: "Sign in before scanning" });
    expect(result.current.importSource).toBe("web");
    await act(() => result.current.commandImport("titles"));
    expect(result.current.importJob?.status).toBe("completed");
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("clears old connection diagnostics when retrying a failed scan", async () => {
    const sendMessage = vi.fn().mockImplementation(async () => { await Promise.resolve(); return { status: "discovering" }; });
    vi.stubGlobal("chrome", { runtime: { id: "test-extension", sendMessage } });
    const { result } = renderHook(() => useImportCommands({ flash: vi.fn(), refreshConversations: vi.fn() }), { wrapper: PreferencesProvider });
    act(() => { result.current.setImportJob({ status: "auth_required", diagnostic: { success: false }, lastError: "Old error" } as ImportJob); result.current.setImportSource("zip"); });
    let request: Promise<void>;
    act(() => { request = result.current.commandImport("failed"); });
    expect(result.current.importJob).toMatchObject({ status: "connecting", lastError: undefined, diagnostic: undefined });
    expect(result.current.importSource).toBe("web");
    await act(() => request!);
  });
  it("resumes only the remaining chosen sources and does not pause when its UI unmounts", async () => {
    const paused = { status: "paused", retryScope: "selected", pendingIds: ["chosen-one", "chosen-two"] } as ImportJob;
    const sendMessage = vi.fn().mockResolvedValue({ ...paused, status: "syncing" });
    vi.stubGlobal("chrome", { runtime: { id: "test-extension", sendMessage } });
    const { result, unmount } = renderHook(() => useImportCommands({ flash: vi.fn(), refreshConversations: vi.fn() }), { wrapper: PreferencesProvider });
    act(() => result.current.setImportJob(paused));
    await act(() => result.current.resumeImport());
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith({ type: "ATLAS_IMPORT_SELECT", conversationIds: ["chosen-one", "chosen-two"] });
    expect(result.current.importJob?.status).toBe("syncing");
    unmount();
    expect(sendMessage).toHaveBeenCalledOnce();
  });
  it("keeps newer progress when an earlier command acknowledgement arrives late", async () => {
    let release!: (value: unknown) => void;
    const sendMessage = vi.fn(() => new Promise(resolve => { release = resolve; }));
    vi.stubGlobal("chrome", { runtime: { id: "test-extension", sendMessage } });
    const refresh = vi.fn();
    const { result } = renderHook(() => useImportCommands({ flash: vi.fn(), refreshConversations: refresh }), { wrapper: PreferencesProvider });
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.commandHydrate(["a"]); });
    act(() => result.current.setImportJob({ sessionId: "current", status: "inventory_ready", completed: 1, updatedAt: 200 } as ImportJob));
    await act(async () => { release({ sessionId: "current", status: "syncing", completed: 0, updatedAt: 100 }); await pending; });
    expect(result.current.importJob).toMatchObject({ status: "inventory_ready", completed: 1 });
    expect(refresh).toHaveBeenCalledOnce();
  });
});

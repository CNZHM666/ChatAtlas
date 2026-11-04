import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences";
import { useImportCommands } from "./useImportCommands";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(tabs: Array<{ id: number; url: string }>) {
  const send = vi.fn().mockResolvedValue({ status: "discovering", sessionId: "native", native: { version: 1, sources: [] } });
  vi.stubGlobal("chrome", { runtime: { id: "extension", sendMessage: send }, tabs: { query: vi.fn().mockResolvedValue(tabs) } });
  const hook = renderHook(() => useImportCommands({ flash: vi.fn(), refreshConversations: vi.fn() }), { wrapper: PreferencesProvider });
  return { ...hook, send };
}
it("starts one detected AI directly even when it has several tabs", async () => {
  const { result, send } = setup([{ id: 1, url: "https://claude.ai/chat/a" }, { id: 2, url: "https://claude.ai/chat/b" }]);
  await act(() => result.current.commandImport("titles"));
  expect(result.current.importChoices).toBeUndefined();
  expect(send).toHaveBeenCalledExactlyOnceWith({ type: "ATLAS_NATIVE_IMPORT_START", sources: [expect.objectContaining({ platform: "claude", tabId: 1 })] });
});
it("waits for explicit selection when several AI platforms are open", async () => {
  const { result, send } = setup([{ id: 1, url: "https://claude.ai/chat/a" }, { id: 2, url: "https://chatgpt.com/c/b" }]);
  await act(() => result.current.commandImport("titles"));
  expect(send).not.toHaveBeenCalled(); expect(result.current.importChoices).toHaveLength(2);
  await act(() => result.current.chooseImportSources([result.current.importChoices![1]]));
  expect(send).toHaveBeenCalledExactlyOnceWith({ type: "ATLAS_NATIVE_IMPORT_START", sources: [expect.objectContaining({ platform: "chatgpt" })] });
});
it("shows the no-source state without silently connecting ChatGPT", async () => {
  const { result, send } = setup([{ id: 1, url: "https://example.com" }]);
  await act(() => result.current.commandImport("titles"));
  expect(result.current.importChoices).toEqual([]); expect(send).not.toHaveBeenCalled();
});

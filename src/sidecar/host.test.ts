import { afterEach, expect, it, vi } from "vitest";
import { sendSidecarMessage, setNativeSidecarTab } from "./host";
afterEach(() => { setNativeSidecarTab(undefined); vi.unstubAllGlobals(); });
it("reports an interrupted channel without replaying an insertion into the AI composer", async () => {
  document.documentElement.lang = "zh-CN"; setNativeSidecarTab(42);
  const send = vi.fn().mockRejectedValue(Error("A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received"));
  vi.stubGlobal("chrome", { runtime: { sendMessage: send } });
  await expect(sendSidecarMessage({ type: "ATLAS_SIDECAR_HANDOFF", conversationId: "current", text: "reviewed context" })).rejects.toThrow("连接已中断");
  expect(send).toHaveBeenCalledExactlyOnceWith({ type: "ATLAS_SIDECAR_HANDOFF", conversationId: "current", text: "reviewed context", tabId: 42 });
});
it("keeps ordinary operation errors intact and localizes a disconnected receiver", async () => {
  document.documentElement.lang = "en"; const original = Error("Missing permission");
  const send = vi.fn().mockRejectedValueOnce(original).mockRejectedValueOnce(Error("Could not establish connection. Receiving end does not exist."));
  vi.stubGlobal("chrome", { runtime: { sendMessage: send } });
  await expect(sendSidecarMessage({ type: "ATLAS_OPEN" })).rejects.toBe(original);
  await expect(sendSidecarMessage({ type: "ATLAS_OPEN" })).rejects.toThrow("Refresh the AI page");
});

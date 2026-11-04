import { describe, expect, it, vi } from "vitest";
import { ensureContentConnection, selectChatGPTTab } from "./chatgpt-connection";

describe("ChatGPT import connection", () => {
  it("prefers an active tab, then a recent conversation tab", () => {
    const recent = { id: 1, url: "https://chatgpt.com/c/recent", lastAccessed: 20 };
    const active = { id: 2, url: "https://chatgpt.com/", active: true, lastAccessed: 5 };
    expect(selectChatGPTTab([recent, active])).toBe(active);
    expect(selectChatGPTTab([recent, { id: 3, url: "https://chatgpt.com/", lastAccessed: 30 }])).toBe(recent);
  });

  it("reinjects after a missing receiver and continues automatically", async () => {
    const ping = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const inject = vi.fn().mockResolvedValue(undefined);
    expect(await ensureContentConnection({ ping, inject, wait: async () => undefined })).toEqual({ ok: true, injected: true });
    expect(inject).toHaveBeenCalledOnce();
  });

  it("returns a structured code only after injection recovery fails", async () => {
    expect(await ensureContentConnection({ ping: async () => false, inject: async () => { throw new Error("blocked"); }, wait: async () => undefined })).toEqual({ ok: false, injected: false, code: "BRIDGE_INJECTION_FAILED" });
  });
});

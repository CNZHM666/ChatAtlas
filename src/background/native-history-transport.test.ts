// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nativeHistoryRequest } from "./native-history-transport";
import type { NativeImportSource } from "../shared/native-import";
const source: NativeImportSource = { id: "deepseek", platform: "deepseek", origin: "https://chat.deepseek.com", tabId: 3, label: "DeepSeek" };
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("userToken", JSON.stringify({ value: "private-login-token" }));
  vi.stubGlobal("location", new URL("https://chat.deepseek.com/"));
  vi.stubGlobal("chrome", { tabs: { get: vi.fn().mockResolvedValue({ id: 3, url: "https://chat.deepseek.com/" }) }, scripting: { executeScript: vi.fn(async (options: { func: (...args: unknown[]) => unknown; args: unknown[] }) => [{ result: await options.func(...options.args) }]) } });
});
afterEach(() => vi.unstubAllGlobals());
it("sends Doubao IM cursors as exact numeric JSON tokens rather than quoted strings", async () => {
  const url = "https://www.doubao.com/chat/123";
  vi.stubGlobal("location", new URL(url));
  vi.stubGlobal("chrome", { tabs: { get: vi.fn().mockResolvedValue({ id: 3, url }) }, scripting: { executeScript: vi.fn(async (options: { func: (...args: unknown[]) => unknown; args: unknown[] }) => [{ result: await options.func(...options.args) }]) } });
  const perf = Object.create(performance);
  Object.defineProperty(perf, "getEntriesByType", { value: () => [] });
  vi.stubGlobal("performance", perf);
  localStorage.setItem("flow_tea_user_id", "test-user");
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status_code: 0 }) });
  vi.stubGlobal("fetch", fetch);
  await nativeHistoryRequest({ ...source, platform: "doubao", origin: "https://www.doubao.com" }, { path: "/im/chain/recent_conv", body: { uplink_body: { pull_recent_conv_chain_uplink_body: { conv_version: "7891234567890123457" } } } });
  expect(fetch.mock.calls[0][1].body).toContain('"conv_version":7891234567890123457');
  expect(fetch.mock.calls[0][1].body).not.toContain('"conv_version":"');
  expect(fetch.mock.calls[0][1].headers["Content-Type"]).toBe("application/json; encoding=utf-8");
  await nativeHistoryRequest({ ...source, platform: "doubao", origin: "https://www.doubao.com" }, { path: "/im/chain/single", body: { uplink_body: { pull_singe_chain_uplink_body: { anchor_index: "9007199254740991" } } } });
  expect(fetch.mock.calls[1][1].body).toContain('"anchor_index":9007199254740991');
});
it("uses login credentials only inside the page and returns a hashed account receipt", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { biz_data: { chat_sessions: [], has_more: false } } }) });
  vi.stubGlobal("fetch", fetch);
  const result = await nativeHistoryRequest({ ...source }, { path: "/api/v0/chat_session/fetch_page" });
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer private-login-token");
  expect(JSON.stringify(result)).not.toContain("private-login-token"); expect(result.account).toMatch(/^[a-f0-9]{64}$/u);
});
it("rejects mutation endpoints before issuing a request", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(nativeHistoryRequest({ ...source }, { path: "/api/v0/chat_session/delete", body: { id: "a" } })).rejects.toThrow("not allowed");
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects an account switch both before and during a history request", async () => {
  const fetch = vi.fn().mockImplementation(async () => { localStorage.setItem("userToken", JSON.stringify({ value: "another-account" })); return { ok: true, json: async () => ({}) }; });
  vi.stubGlobal("fetch", fetch);
  await expect(nativeHistoryRequest({ ...source, account: "different" }, { path: "/api/v0/chat_session/fetch_page" })).rejects.toThrow("Account changed");
  expect(fetch).not.toHaveBeenCalled();
  await expect(nativeHistoryRequest({ ...source }, { path: "/api/v0/chat_session/fetch_page" })).rejects.toThrow("session changed");
});

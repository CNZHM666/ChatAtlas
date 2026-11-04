import { describe, expect, it, vi } from "vitest";
import { NativeHistoryAdapter } from "./native-history-adapter";
import type { HistoryPlatform, NativeImportSource, NativeTransport } from "../shared/native-import";
import type { Conversation } from "../shared/types";

const source = (platform: HistoryPlatform, origin = `https://${platform}.example`): NativeImportSource => ({ id: origin, origin, platform, tabId: 1, label: platform });
const reply = (data: unknown) => ({ account: "account-a", data });
const turn = (id: string, question: string, answer: string) => [[null, id], null, [[question]], [[[`rc-${id}`, [answer]]]], [1700000000]];
describe("native history protocols", () => {
  it.each([
    ["deepseek", "https://chat.deepseek.com", { data: { biz_data: { chat_sessions: [{ id: "a", title: "DeepSeek", updated_at: 1700000000 }], has_more: true } } }, "1700000000"],
    ["kimi", "https://www.kimi.com", { items: [{ chat: { id: "a", name: "Kimi" } }], nextPageToken: "next" }, "next"],
    ["qwen", "https://www.qianwen.com", { data: { list: [{ session_id: "a", title: "Qwen" }], have_next_page: true, next_token: "next" } }, "next"],
    ["qwen", "https://chat.qwen.ai", { data: [{ id: "a", title: "Qwen" }] }, "2"],
    ["doubao", "https://www.doubao.com", { downlink_body: { pull_recent_conv_chain_downlink_body: { cells: [{ conversation: { conversation_id: "123", name: "Doubao" } }], has_more: true, next_conv_version: "456" } } }, "456"],
    ["gemini", "https://gemini.google.com", [null, "next", [["c_a", "Gemini"]]], "next"],
  ] as const)("reads %s native inventory and its continuation", async (platform, origin, data, next) => {
    const transport = vi.fn<NativeTransport>().mockResolvedValue(reply(data));
    const adapter = new NativeHistoryAdapter(source(platform, origin), transport);
    const page = await adapter.list();
    expect(page.next).toBe(next); expect(page.conversations).toHaveLength(1);
    expect(page.conversations[0]).toMatchObject({ platform, sourceAccount: "account-a", messageCount: null });
  });
  it("traverses every Claude organization and keeps detail workspace ownership", async () => {
    const transport = vi.fn<NativeTransport>().mockResolvedValueOnce(reply([{ uuid: "org-a" }, { uuid: "org-b" }])).mockResolvedValueOnce(reply([{ uuid: "chat-a", name: "A" }])).mockResolvedValueOnce(reply([]));
    const adapter = new NativeHistoryAdapter(source("claude", "https://claude.ai"), transport);
    const first = await adapter.list(), second = await adapter.list(first.next);
    expect(first.conversations[0]).toMatchObject({ id: "claude:chat-a", source: "claude_history:org-a" });
    expect(second.next).toBeUndefined();
    expect(transport.mock.calls[2][1].path).toContain("org-b");
  });
  it("reads ChatGPT active and archived history separately", async () => {
    const transport = vi.fn<NativeTransport>().mockResolvedValueOnce(reply({ items: [{ id: "a", title: "A" }], total: 1 })).mockResolvedValueOnce(reply({ items: [], total: 0 }));
    const adapter = new NativeHistoryAdapter(source("chatgpt", "https://chatgpt.com"), transport);
    const first = await adapter.list(), last = await adapter.list(first.next);
    expect(first.conversations[0].id).toBe("a"); expect(last.next).toBeUndefined();
    expect(transport.mock.calls[1][1].path).toContain("is_archived=true");
  });
  it.each([
    ["kimi", "https://www.kimi.com", {}],
    ["gemini", "https://gemini.google.com", [null, null, null]],
  ] as const)("reads an empty %s history page as the end, not a changed format", async (platform, origin, data) => {
    const page = await new NativeHistoryAdapter(source(platform, origin), vi.fn<NativeTransport>().mockResolvedValue(reply(data))).list();
    expect(page).toEqual({ conversations: [], next: undefined });
  });
  it("reads a ChatGPT conversation whose detail carries no id of its own", async () => {
    const detail = { title: "硬件AI方向推荐", current_node: "b", mapping: { a: { message: { id: "a", author: { role: "user" }, content: { parts: ["推荐方向"] } }, children: ["b"] }, b: { parent: "a", message: { id: "b", author: { role: "assistant" }, content: { parts: ["边缘 AI"] } } } } };
    const adapter = new NativeHistoryAdapter({ ...source("chatgpt", "https://chatgpt.com"), account: "account-a" }, vi.fn<NativeTransport>().mockResolvedValue(reply(detail)));
    const conversation = { id: "abc-123", platform: "chatgpt", title: "硬件AI方向推荐", url: "https://chatgpt.com/c/abc-123", createdAt: 1, updatedAt: 1, sourceAccount: "account-a" } as Conversation;
    const capture = await adapter.detail(conversation);
    expect(capture.conversation.id).toBe("abc-123");
    expect(capture.messages.map(message => message.content)).toEqual(["推荐方向", "边缘 AI"]);
  });
  it("follows Gemini message cursors and retains original turn order", async () => {
    const s = { ...source("gemini"), account: "account-a" };
    const transport = vi.fn<NativeTransport>().mockResolvedValueOnce(reply([[turn("r2", "Second question", "Second answer")], "older"])).mockResolvedValueOnce(reply([[turn("r1", "First question", "First answer")], null]));
    const capture = await new NativeHistoryAdapter(s, transport).detail({ id: "gemini:a", platform: "gemini", title: "A", url: "", updatedAt: 1, messageCount: null, sourceAccount: "account-a" });
    expect(transport.mock.calls[1][1].body).toEqual(["c_a", 100, "older", 1, [0], [4], null, 1]);
    expect(capture.messages.map(message => message.content)).toEqual(["First question", "First answer", "Second question", "Second answer"]);
    expect(capture.conversation.historyCoverage).toBe("complete");
  });
  it("rejects malformed and unconfirmed terminal pages instead of completing early", async () => {
    const adapter = new NativeHistoryAdapter(source("deepseek"), async () => reply({ data: { biz_data: { chat_sessions: [] } } }));
    await expect(adapter.list()).rejects.toThrow("format changed");
  });
  it("rejects repeated message pages and account changes", async () => {
    const s = { ...source("gemini"), account: "account-a" };
    const conversation = { id: "gemini:a", platform: "gemini", title: "A", updatedAt: 1, messageCount: null, url: "" } as Conversation;
    await expect(new NativeHistoryAdapter(s, async () => reply([[turn("r", "Question", "Answer")], "same"])).detail(conversation)).rejects.toThrow("Repeated message page");
    await expect(new NativeHistoryAdapter(s, async () => ({ data: [], account: "different" })).list()).rejects.toThrow("Account changed");
  });
  it("refuses a missing body and never returns a complete empty capture", async () => {
    const s = { ...source("deepseek"), account: "account-a" };
    await expect(new NativeHistoryAdapter(s, async () => reply({ data: { biz_data: { chat_messages: [{ message_id: "m", role: "USER", fragments: [] }] } } })).detail({ id: "deepseek:a", platform: "deepseek", title: "A", url: "", updatedAt: 1, messageCount: null })).rejects.toThrow("Missing message text");
  });
  it.each([[undefined], [null], [[]], [[{ type: "THINK", content: "Private reasoning" }]]])("uses the readable body when DeepSeek fragments contain no request/response text: %j", async fragments => {
    const s = { ...source("deepseek"), account: "account-a" };
    const adapter = new NativeHistoryAdapter(s, async () => reply({ data: { biz_data: { chat_messages: [{ message_id: "u", role: "USER", fragments, content: "Original question" }, { message_id: "a", role: "ASSISTANT", fragments, content: "Final answer" }] } } }));
    const capture = await adapter.detail({ id: "deepseek:a", platform: "deepseek", title: "A", url: "", updatedAt: 1, messageCount: null });
    expect(capture.messages.map(message => message.content)).toEqual(["Original question", "Final answer"]);
    expect(capture.conversation.historyCoverage).toBe("complete");
  });
  it("prefers completed response fragments over the fallback body", async () => {
    const s = { ...source("deepseek"), account: "account-a" };
    const adapter = new NativeHistoryAdapter(s, async () => reply({ data: { biz_data: { chat_messages: [{ message_id: "a", role: "ASSISTANT", fragments: [{ type: "THINK", content: "Reasoning" }, { type: "RESPONSE", content: "Final answer" }], content: "Fallback" }] } } }));
    const capture = await adapter.detail({ id: "deepseek:a", platform: "deepseek", title: "A", url: "", updatedAt: 1, messageCount: null });
    expect(capture.messages[0].content).toBe("Final answer");
  });
  it("reads the website's TEMPLATE_RESPONSE on the selected branch and excludes abandoned empty answers", async () => {
    const s = { ...source("deepseek"), account: "account-a" };
    const data = { data: { biz_data: { chat_session: { current_message_id: 2 }, chat_messages: [
      { message_id: 1, parent_id: null, role: "USER", fragments: [{ type: "REQUEST", content: "Question" }] },
      { message_id: 2, parent_id: 1, role: "ASSISTANT", fragments: [{ type: "THINK", content: "Reasoning" }, { type: "TEMPLATE_RESPONSE", content: "Visible answer on the website" }] },
      { message_id: 3, parent_id: 1, role: "ASSISTANT", fragments: [] },
    ] } } };
    const capture = await new NativeHistoryAdapter(s, async () => reply(data)).detail({ id: "deepseek:a", platform: "deepseek", title: "A", url: "", updatedAt: 1, messageCount: null });
    expect(capture.messages.map(message => message.content)).toEqual(["Question", "Visible answer on the website"]);
    expect(capture.conversation.historyCoverage).toBe("complete");
  });
  it("does not publish a DeepSeek branch with missing parents", async () => {
    const s = { ...source("deepseek"), account: "account-a" };
    const data = { data: { biz_data: { chat_session: { current_message_id: 2 }, chat_messages: [{ message_id: 2, parent_id: 1, role: "ASSISTANT", content: "Partial" }] } } };
    await expect(new NativeHistoryAdapter(s, async () => reply(data)).detail({ id: "deepseek:a", platform: "deepseek", title: "A", url: "", updatedAt: 1, messageCount: null })).rejects.toThrow("当前分支不完整");
  });
});

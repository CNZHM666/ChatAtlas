import { afterEach, expect, it, vi } from "vitest";
import { openNativeDiscussion, originalConversationUrl } from "./open-native-discussion";
import type { Conversation, ConversationMessage } from "../shared/types";
const conversation: Conversation = { id: "current", title: "Discussion", platform: "chatgpt", url: "https://chatgpt.com/c/current", messageCount: 4, updatedAt: 1 };
const messages: ConversationMessage[] = ["First question", "First reply", "Current question", "Current reply"].map((content, index) => ({ id: `m${index}`, conversationId: "current", role: index % 2 ? "assistant" : "user", content, preview: content, platformMessageId: `native-${index}`, contentHash: `hash-${index}`, messageIndex: index, createdAt: 1, updatedAt: 1 }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function browser(pingId = "current") {
  const tab = { id: 42, windowId: 7, url: conversation.url };
  const tabs = { query: vi.fn().mockResolvedValue([tab]), get: vi.fn().mockResolvedValue(tab), update: vi.fn().mockResolvedValue(tab), create: vi.fn().mockResolvedValue(tab), sendMessage: vi.fn(async (_id: number, message: { type: string }) => message.type === "ATLAS_PING" ? { ready: true, conversation: { id: pingId } } : { ok: true }) };
  vi.stubGlobal("chrome", { tabs, windows: { update: vi.fn().mockResolvedValue({}) } }); return tabs;
}
it("immediately reuses the exact native conversation and locates the question currently read", async () => {
  const tabs = browser();
  expect(await openNativeDiscussion(conversation, messages, "m3")).toBe("located");
  expect(tabs.update).toHaveBeenCalledExactlyOnceWith(42, { active: true }); expect(tabs.create).not.toHaveBeenCalled();
  expect(tabs.sendMessage).toHaveBeenCalledTimes(2);
  expect(tabs.sendMessage).toHaveBeenLastCalledWith(42, { type: "ATLAS_LOCATE_MESSAGE", conversationId: "current", identity: { messageId: "native-2", contentHash: "hash-2", preview: "Current question", messageIndex: 2, role: "user", anchors: [{ messageId: "native-0", messageIndex: 0 }], text: "Current question", messageCount: 4 } });
});
it("reuses a supported AI conversation despite its history-loading query instead of opening duplicates",async()=>{
 const tabs=browser("kimi:thread"),source={...conversation,id:"kimi:thread",platform:"kimi",url:"https://kimi.com/chat/thread?chat_enter_method=history"};
 const tab={id:42,windowId:7,url:"https://kimi.com/chat/thread"};tabs.query.mockResolvedValue([tab]);tabs.update.mockResolvedValue(tab);tabs.get.mockResolvedValue(tab);
 expect(await openNativeDiscussion(source,messages,"m2")).toBe("located");expect(tabs.create).not.toHaveBeenCalled();expect(tabs.sendMessage).toHaveBeenCalledWith(42,expect.objectContaining({conversationId:"kimi:thread",type:"ATLAS_LOCATE_MESSAGE"}));
});
it("opens this conversation when only another conversation is loaded, retrying only while the page is readying", async () => {
  vi.useFakeTimers(); const tabs = browser(); tabs.query.mockResolvedValue([{ id: 10, url: "https://chatgpt.com/c/other" }]); tabs.sendMessage.mockRejectedValueOnce(Error("not ready"));
  const pending = openNativeDiscussion(conversation, messages, "m2"); await vi.runAllTimersAsync(); expect(await pending).toBe("located");
  expect(tabs.update).not.toHaveBeenCalled(); expect(tabs.create).toHaveBeenCalledWith({ url: conversation.url, active: true }); expect(tabs.sendMessage).toHaveBeenCalledTimes(3);
});
it("stops locating when the user switches the native tab", async () => {
  const tabs = browser(); tabs.get.mockResolvedValue({ id: 42, url: "https://chatgpt.com/c/other" });
  expect(await openNativeDiscussion(conversation, messages, "m2")).toBe("opened"); expect(tabs.sendMessage).not.toHaveBeenCalled();
});
it("keeps unsupported platforms readable without inventing a message deep link", async () => {
  const tabs = browser(); tabs.query.mockResolvedValue([]);
  expect(await openNativeDiscussion({ ...conversation, platform: "claude", url: "https://claude.ai/chat/current" }, messages, "m2")).toBe("opened");
  expect(tabs.create).toHaveBeenCalledWith({ url: "https://claude.ai/chat/current", active: true }); expect(tabs.sendMessage).not.toHaveBeenCalled();
  for (const url of ["", "javascript:alert(1)", "data:text/html,hello"]) expect(originalConversationUrl({ ...conversation, url })).toBeUndefined();
});
it("waits for a slow locate instead of resending it, which would cancel the page's history loading", async () => {
  vi.useFakeTimers(); const tabs = browser();
  tabs.sendMessage.mockImplementation(async (_id: number, message: { type: string }) => message.type === "ATLAS_PING" ? { ready: true, conversation: { id: "current" } } : new Promise(resolve => setTimeout(() => resolve({ ok: true }), 5000)));
  const pending = openNativeDiscussion(conversation, messages, "m2"); await vi.runAllTimersAsync(); expect(await pending).toBe("located");
  expect(tabs.sendMessage.mock.calls.filter(call => (call[1] as { type: string }).type === "ATLAS_LOCATE_MESSAGE")).toHaveLength(1);
});
it("does not locate before the page reports the requested chat", async () => {
  vi.useFakeTimers(); const tabs = browser("other");
  const pending = openNativeDiscussion(conversation, messages, "m2"); await vi.runAllTimersAsync(); expect(await pending).toBe("opened");
  expect(tabs.sendMessage.mock.calls.some(call => (call[1] as { type: string }).type === "ATLAS_LOCATE_MESSAGE")).toBe(false);
});

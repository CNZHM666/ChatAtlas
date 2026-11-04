import { expect, it } from "vitest";
import { discussionQuestion, isCurrentChatGPTConversation,isCurrentNativeConversation } from "./native-discussion";
import {webConversation} from "./web-capture";
import {isNativePanelSite} from "./sidecar-scope";
import type { ConversationMessage } from "./types";
const message = (id: string, role: "user" | "assistant", index: number, replyToMessageId?: string): ConversationMessage => ({ id, role, messageIndex: index, replyToMessageId, platformMessageId: `native-${id}`, conversationId: "c", content: id, preview: id, contentHash: id, createdAt: 0, updatedAt: 0 });
it.each(["https://claude.ai/chat/abc","https://gemini.google.com/app/abc","https://chat.deepseek.com/a/chat/s/abc","https://www.doubao.com/chat/123","https://kimi.com/chat/abc","https://www.qianwen.com/chat/0123456789abcdef0123456789abcdef","https://chat.qwen.ai/c/abc"])("binds native actions to the exact platform identity: %s",url=>{
 const id=webConversation(url)!.id;
 expect(isNativePanelSite(url)).toBe(true);expect(isCurrentNativeConversation(url,id)).toBe(true);
 const spoof=new URL(url);spoof.hostname+=".evil";
 expect(isCurrentNativeConversation(url,id+"other")).toBe(false);expect(isCurrentNativeConversation(spoof.href,id)).toBe(false);
 expect(isCurrentNativeConversation("https://claude.ai/chat/abc",id)).toBe(id==="claude:abc");
});
it("maps assistant fragments to the user question rather than the middle of an answer", () => {
  const messages = [message("u", "user", 0), message("a1", "assistant", 1), message("a2", "assistant", 2), message("next", "user", 3)];
  expect(discussionQuestion(messages.reverse(), "a2")?.id).toBe("u");
  expect(discussionQuestion(messages, "native-u")?.id).toBe("u");
  expect(discussionQuestion(messages, "missing")).toBeUndefined();
});
it("honors stored branch ownership and never guesses when its question was removed", () => {
  const messages = [message("old", "user", 0), message("new", "user", 1), message("branch", "assistant", 2, "native-old"), message("orphan", "assistant", 3, "deleted")];
  expect(discussionQuestion(messages, "branch")?.id).toBe("old"); expect(discussionQuestion(messages, "orphan")).toBeUndefined();
});
it("permits only the exact current ChatGPT conversation URL", () => {
  expect(isCurrentChatGPTConversation("https://chatgpt.com/c/c?x=1", "c")).toBe(true);
  for (const url of ["https://chatgpt.com/c/other", "https://chatgpt.com.evil/c/c", "https://evil/c/c", "https://chatgpt.com/", undefined]) expect(isCurrentChatGPTConversation(url, "c")).toBe(false);
  expect(isCurrentChatGPTConversation("https://chatgpt.com/g/g-project/c/c?x=1", "c")).toBe(true);
  for(const url of ["https://chatgpt.com/g/g-project/c/other","https://chatgpt.com/g/g-project/project","https://evil/g/g-project/c/c","https://chatgpt.com/g/g-project/c/c/other"])expect(isCurrentChatGPTConversation(url,"c")).toBe(false);
});

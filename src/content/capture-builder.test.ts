import { describe, expect, it } from "vitest";
import type { ChatGPTAdapter } from "./chatgpt-adapter";
import { buildConversationCapture, captureFingerprint } from "./capture-builder";
import { createContentHash, normalizeMessageText, previewMessage } from "./message-identity";

describe("message identity", () => {
  it("retains indentation, diagram columns and blank lines inside code without changing prose hashes", async () => {
    const code = "```text\r\n架构\r\n  ┌────┬────┐\r\n  │    │    │\r\n\r\n\r\n\treturn  2\r\n```";
    expect(normalizeMessageText(code)).toBe(code.replace(/\r\n/gu, "\n"));
    expect(normalizeMessageText("    return  2")).toBe("    return  2");
    expect(await createContentHash("prose  words")).toBe(await createContentHash("prose words"));
    expect(await createContentHash("```\n  a  b\n```")).not.toBe(await createContentHash("```\n a b\n```"));
  });
  it("normalizes line endings and produces a stable SHA-256 hash", async () => {
    expect(normalizeMessageText("hello  \r\n\r\n\r\nworld\t  ")).toBe("hello\n\nworld");
    expect(await createContentHash("same content")).toBe(await createContentHash("same content"));
    expect(await createContentHash("same content")).toHaveLength(64);
    expect(previewMessage("a".repeat(300))).toHaveLength(240);
  });
});

describe("buildConversationCapture", () => {
  it("uses platform ids and content hashes for durable local messages", async () => {
    const userElement = document.createElement("article");
    const assistantElement = document.createElement("article");
    const adapter: ChatGPTAdapter = {
      detectConversation: () => ({ id: "conversation-1", title: "Test", url: "https://chatgpt.com/c/conversation-1" }),
      parseMessages: () => [
        { stableId: "message-1", index: 0, role: "user", text: "Question", element: userElement },
        { index: 1, role: "assistant", text: "Answer", element: assistantElement },
      ],
      locateMessage: async () => null,
      followingAssistant: () => null,
      scrollContainer: () => window,
      stickyHeaderBottom: () => 0,
    };

    const capture = await buildConversationCapture(adapter, 1000);
    expect(capture?.conversation.messageCount).toBe(2);
    expect(capture?.messages[0].id).toBe("chatgpt:conversation-1:message-1");
    expect(capture?.messages[1].id).toMatch(/^chatgpt:conversation-1:assistant:[a-f0-9]{64}:0$/);
    expect(capture?.messages[1].replyToMessageId).toBe(capture?.messages[0].id);
    expect(userElement.dataset.atlasContentHash).toHaveLength(64);
    expect(captureFingerprint(capture!)).toContain("conversation-1:Test:2:");
  });
});

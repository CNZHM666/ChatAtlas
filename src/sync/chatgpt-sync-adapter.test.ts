import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatGPTSyncAdapter, ChatGPTSyncError, normalizeHistoryConversation, normalizeHistoryItem } from "./chatgpt-sync-adapter";

afterEach(() => vi.unstubAllGlobals());

describe("ChatGPT history normalization", () => {
  it("uses the active branch and stable message IDs", async () => {
    const capture = await normalizeHistoryConversation({
      id: "conversation-1", title: "A test", update_time: 1_704_067_200, current_node: "answer-new",
      mapping: {
        root: { id: "root", parent: null, message: { id: "root", author: { role: "system" }, content: { parts: ["system"] } } },
        question: { id: "question", parent: "root", message: { id: "question", author: { role: "user" }, content: { parts: ["Hello"] }, create_time: 10 } },
        "answer-old": { id: "answer-old", parent: "question", message: { id: "answer-old", author: { role: "assistant" }, content: { parts: ["Wrong branch"] } } },
        "answer-new": { id: "answer-new", parent: "question", message: { id: "answer-new", author: { role: "assistant" }, content: { parts: ["New answer"] }, create_time: 11 } },
      },
    }, 20_000);
    expect(capture.messages.map((message) => message.content)).toEqual(["Hello", "New answer"]);
    expect(capture.messages[1].id).toBe("chatgpt:conversation-1:answer-new");
    expect(capture.messages[1].replyToMessageId).toBe(capture.messages[0].id);
    expect(capture.conversation.sourceUpdatedAt).toBe(1_704_067_200_000);
  });

  it("rejects items without IDs", () => {
    expect(normalizeHistoryItem({ title: "No ID" })).toBeNull();
  });

  it("keeps discovered metadata without inventing a source date for missing or invalid timestamps", () => {
    expect(normalizeHistoryItem({ id: "missing", title: "Pending" })).toMatchObject({ title: "Pending", importState: "discovered", sourceCreatedAt: undefined, sourceUpdatedAt: undefined });
    expect(normalizeHistoryItem({ id: "epoch", update_time: 0, create_time: 1 })).toMatchObject({ sourceCreatedAt: undefined, sourceUpdatedAt: undefined });
    expect(normalizeHistoryItem({ id: "dated", create_time: 1_704_067_200 })).toMatchObject({ sourceCreatedAt: 1_704_067_200_000, sourceUpdatedAt: undefined });
  });

  it("preserves rate-limit retry timing and treats a dropped fetch as retryable", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: "test" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("limited", { status: 429, headers: { "Retry-After": "2" } }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new ChatGPTSyncAdapter();
    await expect(adapter.fetchConversation("rate-limited")).rejects.toMatchObject({ retryable: true, category: "rate_limit", retryAfterMs: 2000 });
    await expect(adapter.fetchConversation("network-dropped")).rejects.toMatchObject({ retryable: true, category: "network" } satisfies Partial<ChatGPTSyncError>);
  });
});

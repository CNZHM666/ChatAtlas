import { describe, expect, it } from "vitest";
import type { Conversation } from "./types";
import { conversationDisplayTime, conversationTime } from "./conversation-time";

describe("ChatGPT conversation dates", () => {
  it("does not turn missing source timestamps into January 1 or the local import date", () => {
    const conversation: Conversation = { id: "missing", platform: "chatgpt", title: "Missing date", url: "x", updatedAt: Date.now(), messageCount: null, source: "chatgpt_live", importState: "discovered" };
    expect(conversationDisplayTime(conversation)).toBeUndefined();
    expect(conversationTime(conversation)).toBe(0);
  });
});

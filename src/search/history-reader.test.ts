import { expect, it } from "vitest";
import { historyReaderContext } from "./history-reader";
import type { ConversationMessage } from "../shared/types";
const conversation = { id: "c", title: "Source", platform: "chatgpt", url: "", messageCount: 2, updatedAt: 1 };
const messages: ConversationMessage[] = ["Orama 如何使用？", "前文说明\n\n用 Orama 保存索引。\n\n后续说明"].map((content, index) => ({ id: `m${index}`, conversationId: "c", role: index ? "assistant" : "user", content, preview: content, messageIndex: index, contentHash: "", createdAt: 1, updatedAt: 1 }));
it("keeps a separate real excerpt and range for every matched message", () => {
  const context = historyReaderContext({ conversation, messages, excerpt: "Orama", score: 1 }, "Orama", messages);
  expect(context.hits).toHaveLength(2);
  for (const hit of context.hits) { expect(hit.excerpt).toBe("Orama"); expect(hit.sourceRange).toEqual(expect.objectContaining({ excerpt: "Orama" })); }
  expect(context.hits[1].sourceRange?.start).toBe(messages[1].content.indexOf("Orama"));
});
it("discards changed, missing and duplicate hits instead of citing a full old answer", () => {
  const context = historyReaderContext({ conversation, messages: [...messages, messages[0]], excerpt: "Orama", score: 1 }, "Orama", [{ ...messages[0], content: "edited" }, messages[1]]);
  expect(context.hits.map(hit => hit.messageId)).toEqual(["m1"]);
});

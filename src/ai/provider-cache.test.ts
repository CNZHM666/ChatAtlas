import { expect, it } from "vitest";
import { cacheableMessages } from "./provider";

it("marks long fixed instructions cacheable on DashScope only", () => {
  const messages = [{ role: "system" as const, content: "规则".repeat(2000) }, { role: "user" as const, content: "批次内容" }];
  const marked = cacheableMessages(messages, "https://dashscope.aliyuncs.com/compatible-mode/v1");
  expect(marked[0].content).toEqual([{ type: "text", text: messages[0].content, cache_control: { type: "ephemeral" } }]);
  expect(marked[1]).toEqual(messages[1]);
  expect(cacheableMessages(messages, "https://api.openai.com/v1")).toBe(messages);
  // Short instructions stay plain: below the cache minimum they would only pay for the cache write.
  expect(cacheableMessages([{ role: "system", content: "简短" }], "https://dashscope.aliyuncs.com/compatible-mode/v1")[0].content).toBe("简短");
});

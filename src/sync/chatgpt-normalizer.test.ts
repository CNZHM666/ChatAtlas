import { expect, it } from "vitest";
import { normalizeHistoryConversation, normalizeHistoryItem } from "./chatgpt-normalizer";

it("distinguishes original provider message times from capture-time fallbacks", async () => {
  const raw = { id: "dated", current_node: "a", mapping: { u: { message: { id: "u", author: { role: "user" }, content: { parts: ["dated question"] }, create_time: 1700000000 } }, a: { parent: "u", message: { id: "a", author: { role: "assistant" }, content: { parts: ["unknown date"] } } } } };
  const result = await normalizeHistoryConversation(raw);
  expect(result.messages[0].sourceCreatedAt).toBe(1700000000000);
  expect(result.messages[1].sourceCreatedAt).toBeUndefined();
});

it("reads typed text and code parts while keeping interactive data out of the article", async () => {
  const raw = { id: "typed", current_node: "a", mapping: { a: { message: { id: "a", author: { role: "assistant" }, content: { parts: [{ type: "text", text: "前提条件" }, { type: "code", language: "python", text: "if ready:\n    do_work()\n\n\n    finish()" }, { type: "text", text: { value: "结论保留" } }, { type: "genui", payload: { script: "do_not_run" } }] } } } } };
  const capture = await normalizeHistoryConversation(raw);
  expect(capture.messages[0].content).toContain("```python\nif ready:\n    do_work()\n\n\n    finish()\n```");
  expect(capture.messages[0].content).toContain("结论保留");
  expect(capture.messages[0].content).toContain("【原平台交互内容】");
  expect(capture.messages[0].content).not.toContain("do_not_run");
  expect(capture.messages[0].uiParts).toEqual([{ ordinal: 0, raw: '{"type":"genui","payload":{"script":"do_not_run"}}' }]);
});

it("retains UI-only responses and bounds typed payloads without deleting the following answer", async () => {
  const raw = { id: "ui", mapping: { a: { message: { author: { role: "assistant" }, content: { parts: [{ type: "html", text: "<section>UI</section>" }, { type: "genui", payload: { data: "x".repeat(200001) } }, "后续条件"] } } } } };
  const capture = await normalizeHistoryConversation(raw);
  expect(capture.messages[0].content).toBe("【原平台交互内容】\n【原平台交互内容】\n后续条件");
  expect(capture.messages[0].uiParts![0].raw).toContain("<section>UI</section>");
  expect(capture.messages[0].uiParts![1]).toEqual({ ordinal: 1, raw: "", truncated: true });
});

it("keeps whitespace inside inline genui JSON payloads instead of compacting their HTML", async () => {
  const payload = JSON.stringify({ html: '<section><pre>  first\n    second</pre><p>two  spaces</p></section>' });
  const content = `前提\ngenui${payload}\n结论`;
  const capture = await normalizeHistoryConversation({ id: "inline-ui", mapping: { a: { message: { author: { role: "assistant" }, content: { parts: [content] } } } } });
  expect(capture.messages[0].content).toBe(content);
});

it("names a conversation by conversation_id when it carries no id", () => {
  expect(normalizeHistoryItem({ conversation_id: "abc-123", title: "硬件AI方向推荐" })).toMatchObject({ id: "abc-123", url: "https://chatgpt.com/c/abc-123" });
  expect(normalizeHistoryItem({ title: "无 ID" })).toBeNull();
});

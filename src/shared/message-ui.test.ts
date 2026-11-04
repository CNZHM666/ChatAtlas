import { expect, it } from "vitest";
import { messagePresentation, widgetMarkup } from "./message-ui";

it("keeps adjacent widgets and surrounding prose in source order", () => {
  const content = '开始\ngenui{"html":"<p>步骤</p>"}\n中间\n【原平台交互内容】\n结束';
  const parts = messagePresentation(content, [{ ordinal: 0, raw: '{"type":"widget","id":"original"}' }]);
  expect(parts.map(part => part.kind)).toEqual(["text", "ui", "text", "ui", "text"]);
  expect(parts[2]).toEqual({ kind: "text", text: "\n中间\n" });
  expect(parts.at(-1)).toEqual({ kind: "text", text: "\n结束" });
});
it("protects user examples, fenced JSON, inline markers and ordinary types", () => {
  const widget = 'genui{"html":"<p>Literal</p>"}';
  const text = `\`${widget}\`\n\n\`\`\`json\n${widget}\n【原平台交互内容】\n\`\`\``;
  expect(messagePresentation(text, [{ ordinal: 0, raw: "{}" }])).toEqual([{ kind: "text", text }]);
  expect(messagePresentation(widget, [], true)).toEqual([{ kind: "text", text: widget }]);
  expect(messagePresentation('{"html":"<p>普通 JSON</p>"}', [])).toHaveLength(1);
});
it("uses fallback text only when it exactly matches the retained article", () => {
  const part = { ordinal: 0, raw: "{}", fallbackText: "选择项目\n加入上下文" };
  const content = "前提\n【原平台交互内容】\n选择项目\n加入上下文\n结论";
  expect(messagePresentation(content, [part])[1]).toMatchObject({ kind: "ui", fallbackText: part.fallbackText });
  expect(messagePresentation(content.replace("选择项目", "已修改"), [part])[2]).toMatchObject({ kind: "text", text: "\n已修改\n加入上下文\n结论" });
});
it("recognizes actual supplied HTML resources without treating scripts, URLs or component IDs as templates", () => {
  expect(widgetMarkup(JSON.stringify({ contents: [{ mimeType: "text/html;profile=mcp-app", text: "<p>原始组件</p>" }] }))).toEqual({ language: "html", source: "<p>原始组件</p>" });
  expect(widgetMarkup('{"payload":{"svg":"<svg/>"}}')).toEqual({ language: "svg", source: "<svg/>" });
  expect(widgetMarkup('{"script":"run()","url":"https://example.com","widget":"quiz"}')).toBeUndefined();
  expect(widgetMarkup("x".repeat(200001))).toBeUndefined();
});

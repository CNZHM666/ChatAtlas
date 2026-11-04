import { describe, expect, it } from "vitest";
import { hasReadableMessageGap, isInternalSearchQueryMessage, readableConversationText, readablePlatformMarkup, renderableConversationText } from "./conversation-text";

describe("readable conversation text", () => {
  it("normalizes exported Link components without DOM access while retaining literal code and blocking unsafe protocols", () => {
    expect(readableConversationText('<Link url="https://example.com?a=1&amp;b=2" title="项目 &quot;说明&quot;"/>')).toBe('[项目 "说明"](https://example.com?a=1&b=2)');
    expect(readableConversationText('&lt;Link url=&quot;https://example.com&quot; title=&quot;资料&quot;/&gt;')).toBe('[资料](https://example.com)');
    expect(readableConversationText('<Link url="javascript:alert(1)" title="资料"/>')).toBe('资料');
    const code = '```jsx\n<Link url="https://example.com" title="资料"/>\n```';
    expect(readableConversationText(code)).toBe(code); expect(readableConversationText('`<Link url="https://example.com"/>`')).toBe('`<Link url="https://example.com"/>`');
  });
  it("removes generated Cite markup and keeps URL labels without fabricating links", () => {
    const cite = '<Cite refs={["turn106006search3","turn106006search8"]}/>';
    const token = "urlChatsRecallturn809230search11";
    expect(readableConversationText(`结论\\${cite} 官网：${token}。后续条件保留。`)).toBe("结论 官网：ChatsRecall。后续条件保留。");
    expect(readableConversationText('依据 &lt;Cite refs={["turn1search2"]}/&gt; 后文')).toBe("依据  后文");
    const code = `\`\`\`jsx\n${cite}\n\`\`\`\n\`${token}\``;
    expect(readableConversationText(code)).toBe(code);
    expect(readableConversationText('<Cite refs={["my-source"]}/>')).toBe('<Cite refs={["my-source"]}/>');
  });
  it("hides internal file citations in prose while leaving literal code and stored material intact", () => {
    const token = "fileciteturn0file0L78-L84";
    const original = `结论。${token}\n继续阅读。`;
    expect(readableConversationText(original)).toBe("结论。\n继续阅读。");
    expect(original).toContain(token);
    expect(readableConversationText(`结论。${token.slice(0, -1)}`)).toBe("结论。");
    expect(readableConversationText(`结论。${token.slice(0, -1)}继续阅读。`)).toBe("结论。继续阅读。");
    expect(readableConversationText("结论。fileciteturn0file0\nL78-L84后续条件。")).toBe("结论。后续条件。");
    const code = `\`${token}\`\n\n\`\`\`text\n${token}\n\`\`\`\n\n    ${token}`;
    expect(readableConversationText(code)).toBe(code);
  });
  it("replaces finance and balanced interactive payloads without consuming the following answer", () => {
    const input = '开头。financeturn246182finance0\ngenui{"suggest_automation":{"label":"AI","nested":[{"code":"x = {1: 2}"}]}}\n\n后续条件与结论。';
    expect(readableConversationText(input)).toBe("开头。【原平台行情图表】\n【原平台交互内容】\n\n后续条件与结论。");
    expect(input).toContain("suggest_automation");
  });
  it("retains quoted code, user examples, ordinary JSON and links", () => {
    const token = 'genui{"label":"Example"}';
    expect(readableConversationText(`\`${token}\`\n\n\`\`\`text\n${token}\n\`\`\``)).toBe(`\`${token}\`\n\n\`\`\`text\n${token}\n\`\`\``);
    expect(renderableConversationText(token, true)).toBe(token);
    expect(readableConversationText('JSON {"finance":42,"genui":"text"} [原文](https://example.com)')).toBe('JSON {"finance":42,"genui":"text"} [原文](https://example.com)');
  });
  it("handles adjacent, terminated and incomplete widget payloads while retaining trailing prose after valid JSON", () => {
    expect(readableConversationText('financeturn1finance0financeturn1finance1')).toBe("【原平台行情图表】【原平台行情图表】");
    expect(readableConversationText(`genui${JSON.stringify({ label: 'a "quoted" value' })}正文`)).toBe("【原平台交互内容】正文");
    expect(readableConversationText('开头genui{"label":"unfinished')).toBe("开头【原平台交互内容】");
  });
  it("removes memory citation variants and incomplete final markers without removing nearby prose", () => {
    expect(readableConversationText("结论。memcite\n后续条件。memciteturn1memory0" )).toBe("结论。\n后续条件。");
    expect(readableConversationText("结论。memciteturn1memory0")).toBe("结论。");
    expect(readableConversationText("请核对 cite 和 memcite 的区别。")).toBe("请核对 cite 和 memcite 的区别。");
  });
  it("removes internal citation tokens while preserving surrounding content and links", () => {
    expect(readableConversationText("参考 [原文](https://example.com)citeturn253499search1turn138020view1。"))
      .toBe("参考 [原文](https://example.com)。");
  });
});

describe("conversation reading text", () => {
  it("renders bracketed LaTeX while leaving fenced code alone", () => {
    expect(renderableConversationText("[ \\dot{x}=Ax+Bu ]")).toContain("$$\n\\dot{x}=Ax+Bu\n$$");
    expect(renderableConversationText("\\[ \\dot{x}=Ax+Bu \\]")).toContain("$$\n\\dot{x}=Ax+Bu\n$$");
    expect(renderableConversationText("\\(x^2\\)")).toBe("$x^2$");
    expect(renderableConversationText("$$x^2+y^2$$")).toBe("$$\nx^2+y^2\n$$");
    expect(renderableConversationText("平方 $x^2$。")).toBe("平方 $x^2$。");
    expect(renderableConversationText("`\\(x^2\\)` 与 `$$x^2$$`")).toBe("`\\(x^2\\)` 与 `$$x^2$$`");
    expect(renderableConversationText("```text\n[ \\dot{x}=Ax+Bu ]\n```")).toBe("```text\n[ \\dot{x}=Ax+Bu ]\n```");
  });

  it("hides only standalone internal search requests, without inventing a discussion gap", () => {
    const internal = { role: "assistant", content: '{"query":"find an old discussion"}', messageIndex: 1 };
    expect(isInternalSearchQueryMessage(internal)).toBe(true);
    expect(isInternalSearchQueryMessage({ role: "tool", content: '```json\n{"query":"find an old discussion"}\n```' })).toBe(true);
    expect(isInternalSearchQueryMessage({ role: "user", content: '{"query":"find an old discussion"}' })).toBe(false);
    expect(isInternalSearchQueryMessage({ role: "assistant", content: '{"query":"term","answer":"Use this"}' })).toBe(false);
    expect(hasReadableMessageGap([{ role: "user", content: "Q", messageIndex: 0 }, internal, { role: "assistant", content: "A", messageIndex: 2 }], 0, 2)).toBe(false);
  });
});

it("shows exported layout markup as its words: entities by name and wrappers removed", () => {
  const reply = "<box>\n    **<Entity category=\"software\" value=\"ChatGPT Projects\"/>**\n\n    可以集中管理项目对话。<Cite ref=\"turn302039view2\"/>\n</box>\n<text color=\"secondary\" size=\"sm\">「之后再说」</text>\n\n```ts\nconst box = \"<box>\";\n```";
  const shown = readablePlatformMarkup(reply);
  expect(shown).toContain("**ChatGPT Projects**");
  expect(shown).toContain("可以集中管理项目对话。");
  expect(shown.split("```")[0]).not.toMatch(/<Entity|<\/?box>|<text\b/u);
  expect(shown.split("\n").some(line => /^ {4}/u.test(line))).toBe(false);
  expect(shown).toContain('const box = "<box>";');
});

import { expect, it } from "vitest";
import { evidencePresentation } from "./evidence-presentation";
import { reviewLead } from "./review-presentation";

it("removes wire citation annotations and ranges from generated prose without shortening sentences", () => {
  const text = "从需求出发[e12]，验证方案【来源：e2、e3】。保留限制（参见 e5–e8）。\n引用：e7, e9\n明确方向[^e11]。";
  expect(evidencePresentation(text)).toBe("从需求出发，验证方案。保留限制。\n\n明确方向。");
  expect(reviewLead("需求说明[e12]。第二步【e3】。", 2)).toBe("需求说明。第二步。");
});

it("removes wire IDs written as pseudo tags but keeps real tags and code",()=>{
  expect(evidencePresentation("设计目标是优化上下文理解。<e2>\n- **检索**：不依赖模型记忆。<e1><e17>\n区别在于入口<e3>，而非存储。")).toBe("设计目标是优化上下文理解。\n- **检索**：不依赖模型记忆。\n区别在于入口，而非存储。");
  const literal="使用 <em>强调</em> 与 `<e2>`。";
  expect(evidencePresentation(literal)).toBe(literal);
});

it("preserves variables, scientific notation, code, math, links, footnote definitions and original input", () => {
  const text = "变量 e12，1e10，`[e12]`，$[e3]$，[e2](https://example.com/e2)。\nhttps://example.com/[e2]\n~~~js\nconst e12 = [e3];\n~~~\n    [e7]\n$$\n[e8]\n$$\n[^e1]: User footnote\n[e2][link]\n[link]: https://example.com";
  expect(evidencePresentation(text)).toBe(text);
  expect(evidencePresentation("Unfinished fence\n```js\n[e1]")).toBe("Unfinished fence\n```js\n[e1]");
});

it("hides proof-range metadata and its separators, including a missing opening bracket", () => {
  expect(evidencePresentation("结论。[e16:1]-[e16:10], [e17:1]-[e17:10], [e18:1]-[e18:10]")).toBe("结论。");
  expect(evidencePresentation("e16:1]-[e16:10], [e17:1]–[e17:10]\n依据【e2:3】。正文[e4:5]。")).toBe("\n依据。正文。");
  expect(evidencePresentation("正文[e1:2][e2:3]。\n[e3:1]-[e3:2]")).toBe("正文。\n");
});

it("preserves proof-like notation in real links, definitions, code, math and URLs", () => {
  const text = "`[e16:1]-[e16:10]` $[e16:1]-[e16:10]$ [e16:1](https://example.com)\n[e1:1]-[e1:2]\n[e1:1]: https://example.com\n变量 e16:1 与 URL https://example.com/[e2:1]-[e2:2]";
  expect(evidencePresentation(text)).toBe(text);
});
it("removes empty citation wrappers and separators left in old generated summaries",()=>{
  expect(evidencePresentation("保留项目介绍。\n\n> 引用来源：[e1]，[e2]，[e3]，[e4]\n\n继续阅读。")).toBe("保留项目介绍。\n\n\n\n继续阅读。");
  for(const line of ["> 引用来源：，，，，","> **引用来源：** [e1], [e2]","> Sources: [e1]; [e2]","> 引用来源：\n> [e1]，[e2]","- 参考来源：[e1]"]){expect(evidencePresentation(line).trim()).toBe("");}
});
it("preserves meaningful source labels, literal examples, references and technical punctuation",()=>{
  const text="> 引用来源：[项目讨论](https://example.com)\n> 引用来源：用户明确说明首版不做采购。\n引用来源：`[e1]`\n引用来源：[e1][original]\n[original]: https://example.com\n~~~text\n引用来源：，，，，\n~~~\n变量 e1，e2；\n> 普通引用内容";
  expect(evidencePresentation(text)).toBe(text);
});

it("cleans only citation-created trailing separators in stage cards",()=>{
 expect(evidencePresentation("完善 README 和 Topics，[e1]，[e2]。\n权限最小化[e1]，。\n发布[e2]。" )).toBe("完善 README 和 Topics。\n权限最小化。\n发布。");
 expect(evidencePresentation("参数：a，b；限制仍有效。\n`[e1]，[e2]`，数学 $[e1]$。" )).toBe("参数：a，b；限制仍有效。\n`[e1]，[e2]`，数学 $[e1]$。");
});
it("cleans nested list citations and continuation prose while retaining indented and fenced code",()=>{
 const text="- 验证指标：\n\n    - 10 名测试者 [e15]。\n    - 首次完成率 ≥ 70% [e15]。\n      补充说明 [e14]，。\n\n- 技术示例：\n\n      [e15]，。\n\n  ```text\n  [e14]，。\n  ```\n\n    [e16]";
 expect(evidencePresentation(text)).toBe("- 验证指标：\n\n    - 10 名测试者。\n    - 首次完成率 ≥ 70%。\n      补充说明。\n\n- 技术示例：\n\n      [e15]，。\n\n  ```text\n  [e14]，。\n  ```\n\n");
 expect(evidencePresentation("    - literal [e15]，。\n    [e14]")).toBe("    - literal [e15]，。\n    [e14]");
});
it("removes empty outer wrappers created by hiding wire citations but keeps literal arrays and links",()=>{
 expect(evidencePresentation("失败保留原文 [[e1]]，确认后再执行 [ [e2] ]。")).toBe("失败保留原文，确认后再执行。");
 const literals="返回空数组 []。\n\n`const items = [];`\n\n[详情](https://example.com)\n\n```js\nconst values = [];\n```";
 expect(evidencePresentation(literals)).toBe(literals);
});

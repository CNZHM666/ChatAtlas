import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ReaderGuide } from "./ReaderGuide";
import { structureCode } from "../../test/structure-metadata-fixture";
import {leakedClaims} from "../../test/claims-prose-fixture";
afterEach(cleanup);
const emphasisFiller="原始讨论按照发生顺序保存，阅读时逐步恢复以前形成的理解。".repeat(9);
it("uses AI建议 only for generated prose and leaves suggestion status unemphasized",()=>{
 const original="助手建议采用本地保存原文。",view=render(<ReaderGuide content={original} zh complete hideEvidenceMarkers highlights={{sectioned:true,phrases:["采用本地保存原文"]}}/>);
 expect(view.container).toHaveTextContent("AI建议采用本地保存原文");expect(view.container.querySelector("strong")).toBeNull();
 view.rerender(<ReaderGuide content={original} zh complete/>);expect(view.container).toHaveTextContent(original);
});
it("distributes distinct claim emphasis across later Wiki subtopics with a local density limit",()=>{
 const phrases=Array.from({length:7},(_,index)=>`第${index}模块只读取已保存原文`);
 const original=phrases.map((phrase,index)=>`## 主题${index}\n\n${phrase}，其余说明保持正常字重。\n\n${emphasisFiller}`).join("\n\n");
 const view=render(<ReaderGuide content={original} zh complete highlights={{sectioned:true,phrases}}/>);
 expect([...view.container.querySelectorAll("strong")].map(node=>node.textContent)).toEqual(phrases);
 expect(view.container.querySelectorAll("h2 strong")).toHaveLength(0);
 const text=view.container.textContent;view.rerender(<ReaderGuide content={original} zh complete/>);expect(view.container.textContent).toBe(text);
});
it("does not spend later-subtopic emphasis on the same repeated claim and caps one subtopic at one cue",()=>{
 const repeated="保留原始正文与完整条件",other="所有来源均需人工核对",third="第三条说明不需要全部加粗";
 const original=`## 第一部分\n\n${repeated}。\n\n${other}。\n\n${third}。\n\n${emphasisFiller}\n\n## 第二部分\n\n${repeated}。\n\n${third}。\n\n${emphasisFiller}`;
 const view=render(<ReaderGuide content={original} zh complete highlights={{sectioned:true,phrases:[repeated,other,third]}}/>);
 expect([...view.container.querySelectorAll("strong")].map(node=>node.textContent)).toEqual([repeated,third]);
});
it("matches harmless spacing changes and preserves adjacent negation while skipping introductory suggestions",()=>{
 const original=`概览不额外突出。\n\n## 边界\n\n不得自动发送用户消息。\n\n助手建议采用本地保存原文。\n\n${emphasisFiller}\n\n## 数据\n\nHardware   IR 保留完整条件。\n\n${emphasisFiller}\n\n> 不得自动发送用户消息。\n\n\`自动发送用户消息\``;
 const view=render(<ReaderGuide content={original} zh complete highlights={{sectioned:true,phrases:["自动发送用户消息","采用本地保存原文","Hardware IR 保留完整条件"]}}/>);
 expect([...view.container.querySelectorAll("strong")].map(node=>node.textContent)).toEqual(["不得自动发送用户消息","Hardware   IR 保留完整条件"]);
 expect(view.container.querySelector("blockquote strong")).toBeNull();expect(view.container.querySelector("code strong")).toBeNull();
});
it("adds bounded reading emphasis without changing prose, code, quotes or existing bold",()=>{
 const original="这份文档说明用户确认后才保存资料。后面仍须保留全部条件。\n\n关键约束：失败时保留原文。\n\n**原有重点**不得改变。\n\n> 引用内容：不能自动选择。\n\n`代码条件：不修改`\n\n普通段落保留原样。";
 const view=render(<ReaderGuide content={original} zh complete highlights={{lead:true}}/>);
 expect(screen.getByText("这份文档说明用户确认后才保存资料。").tagName).toBe("STRONG");
 expect(screen.getByText("关键约束").tagName).toBe("STRONG");
 expect(screen.getByText("原有重点").tagName).toBe("STRONG");
 expect(view.container.querySelector("blockquote strong")).toBeNull();
 expect(view.container.querySelector("code strong")).toBeNull();
 const emphasized=view.container.textContent;
 view.rerender(<ReaderGuide content={original} zh complete/>);
 expect(view.container.textContent).toBe(emphasized);
 expect(view.container.querySelectorAll("strong")).toHaveLength(1);
});
it("emphasizes only literal claim text, at most once per paragraph and three times overall",()=>{
 const phrase="失败时保留原文与完整条件";
 const original=Array.from({length:8},(_,index)=>`说明${index}：${phrase}，不能丢弃其他信息。`).join("\n\n");
 const view=render(<ReaderGuide content={original} zh complete highlights={{phrases:[phrase,"正文没有出现的结论"]}}/>);
 expect(view.container.querySelectorAll("strong")).toHaveLength(3);
 expect([...view.container.querySelectorAll("strong")].every(node=>node.textContent===phrase)).toBe(true);
 expect(view.container).not.toHaveTextContent("正文没有出现的结论");
});
it("hides complete internal claim rows in generated reading while leaving source reading unchanged",()=>{
 const body=`Notion 是可选目的地。\n\n${leakedClaims}\n\nFind → Verify → Update → Reuse。`;
 const view=render(<ReaderGuide content={body} zh complete hideEvidenceMarkers/>);
 expect(view.container).not.toHaveTextContent("evidenceIds");expect(view.container).not.toHaveTextContent("Claims:");expect(view.container).toHaveTextContent("Find → Verify → Update → Reuse");
 view.rerender(<ReaderGuide content={body} zh complete/>);expect(view.container).toHaveTextContent("evidenceIds");
 view.rerender(<ReaderGuide content={body} sourceTexts={[leakedClaims]} zh complete hideEvidenceMarkers/>);expect(view.container).toHaveTextContent("evidenceIds");
});
it.each([
 "> *引用来源：* ，，，，",
 "> **引用来源**：\n> ，，，，",
 "> 引用来源：\n>\n> ，，、；",
 "> 引用来源：\u200b，，，",
 "> CitationS：\n> ，，，，",
])("omits a malformed empty source quote without replacing the original excerpt style: %s",quote=>{
 const view=render(<ReaderGuide content={`前文。\n\n${quote}\n\n后文。`} zh complete hideEvidenceMarkers/>);
 expect(view.container.querySelector("blockquote")).toBeNull();expect(view.container).toHaveTextContent("前文。");expect(view.container).toHaveTextContent("后文。");
 view.rerender(<ReaderGuide content={quote} zh complete/>);expect(view.container.querySelector("blockquote")).not.toBeNull();
});
it("preserves the familiar excerpt block, including multiline labels and genuine links or code",()=>{
 const content="> 引用来源：\n> 确认采用 Hardware IR 作为统一数据源。\n\n> 引用来源：[原始讨论](https://example.com)\n\n> 引用来源：`[e1]`";
 const view=render(<ReaderGuide content={content} zh complete hideEvidenceMarkers/>);
 const quotes=view.container.querySelectorAll("blockquote");expect(quotes).toHaveLength(3);
 expect(quotes[0]).toHaveTextContent("引用来源： 确认采用 Hardware IR 作为统一数据源。");expect(quotes[1].querySelector("a")).toHaveAttribute("href","https://example.com");expect(quotes[2].querySelector("code")).toHaveTextContent("[e1]");
 expect(view.container.querySelector(".source-citations")).toBeNull();
});
it("omits empty generated citation blockquotes while leaving original or personal text intact",()=>{
  const text="Hardware IR 是统一数据源。\n\n> 引用来源：[e1]，[e2]，[e3]\n\n下一步验证执行器。";
  const view=render(<ReaderGuide content={text} zh complete hideEvidenceMarkers/>);
  expect(view.container).toHaveTextContent("Hardware IR 是统一数据源。");expect(view.container).toHaveTextContent("下一步验证执行器。");
  expect(view.container.querySelector("blockquote")).toBeNull();expect(view.container).not.toHaveTextContent("引用来源");
  view.rerender(<ReaderGuide content={text} zh complete/>);expect(view.container.querySelector("blockquote")).toHaveTextContent("引用来源：[e1]，[e2]，[e3]");
  expect(text).toContain("[e1]，[e2]，[e3]");
});
it("renders imported and generated display formulas in the same layout without changing code examples", async () => {
  const original = String.raw`$$\boxed{x^2=1+t}$$

Inline $y^2$.

\[\frac{dz}{dt}\]

\`\`\`text
$$literal$$
\`\`\``.replaceAll("\\`", "`");
  const { container, rerender } = render(<ReaderGuide content={original} zh complete />);
  await waitFor(() => expect(container.querySelectorAll(".katex-display")).toHaveLength(2));
  expect(container.querySelector(".katex-display .fbox")).not.toBeNull();
  expect(container.querySelector("code")).toHaveTextContent("$$literal$$");
  rerender(<ReaderGuide content={original} zh complete hideEvidenceMarkers />);
  await waitFor(() => expect(container.querySelectorAll(".katex-display")).toHaveLength(2));
  expect(original).toContain("$$\\boxed{x^2=1+t}$$");
});
it("hides only leaked structure metadata in old generated articles, preserving personal text and original code", () => {
  const content = `计划开展观察测试。\n\n${structureCode}\n\n\`\`\`js\nconst testCount = 5;\n\`\`\``;
  const view = render(<ReaderGuide content={content} zh complete hideEvidenceMarkers />);
  expect(view.container).not.toHaveTextContent("validation_bench");
  expect(view.container.querySelector("pre code")).toHaveTextContent("const testCount = 5;");
  view.rerender(<ReaderGuide content={content} zh complete />);
  expect(view.container).toHaveTextContent("validation_bench");
  view.rerender(<ReaderGuide content={`代码示例：\n\n${structureCode}`} zh complete hideEvidenceMarkers />);
  expect(view.container).toHaveTextContent("validation_bench");
  view.rerender(<ReaderGuide content={content} sourceTexts={[structureCode]} zh complete hideEvidenceMarkers />);
  expect(view.container).toHaveTextContent("validation_bench");
});
it("keeps audit summaries optional, localizes their labels and preserves genuine comparisons and the saved article", () => {
  const audit = "| 概念 | 状态 | 说明 |\n| --- | --- | --- |\n| Physical Validation | Supported | 真实硬件验证提高可信度 |\n| Procurement MVP | Uncertain | 是否包含采购接口仍需核对 |";
  const comparison = "| 方案 | 成本 |\n| --- | --- |\n| 复用 | 低 |";
  const original = `${audit}\n\n${comparison}\n\n\`Supported\``;
  const { container, unmount } = render(<ReaderGuide content={original} zh complete hideEvidenceMarkers />);
  expect(container.querySelector(".reader-supplement")?.hasAttribute("open")).toBe(false);
  expect(screen.getByText("实物验证")).not.toBeVisible();
  expect(container.querySelector(".conversation-answer-markdown .reader-table-scroll > table")).toHaveTextContent("方案成本复用低");
  fireEvent.click(screen.getByText("补充说明"));
  expect(screen.getByText("依据支持")).toBeVisible();
  expect(screen.getByText("待核对")).toBeVisible();
  expect(container.querySelector("code")).toHaveTextContent("Supported");
  expect(original).toContain("Physical Validation | Supported");
  unmount();
  render(<ReaderGuide content={original} zh complete />);
  expect(screen.getByText("Physical Validation")).toBeVisible();
  expect(screen.queryByText("补充说明")).toBeNull();
});

it("suppresses exactly repeated all-supported audit prose without touching business status tables", () => {
  const content = "真实硬件验证提高可信度。\n\n| 概念 | 状态 | 说明 |\n| --- | --- | --- |\n| Physical Validation | Supported | 真实硬件验证提高可信度 |\n\n| 概念 | 状态 | 说明 |\n| --- | --- | --- |\n| 项目部署 | 已完成 | 保留真实部署状态 |";
  render(<ReaderGuide content={content} zh complete hideEvidenceMarkers />);
  expect(screen.queryByText("Physical Validation")).toBeNull();
  expect(screen.getByRole("table")).toHaveTextContent("已完成");
  expect(screen.getByText("真实硬件验证提高可信度。")).toBeVisible();
});
it("renders emphasis around Chinese quotes without altering code, escaped syntax or saved text", () => {
  const content = '确立**“清晰排版与结构”**目标，采用**「规则校验」**双引擎。\n\n**普通加粗**\n\n`**“代码原样”**`\n\n\\*\\*“保留星号”\\*\\*';
  const view = render(<ReaderGuide content={content} zh complete />);
  expect(view.container.querySelectorAll("strong")).toHaveLength(3);
  expect(screen.getByText("“清晰排版与结构”").tagName).toBe("STRONG");
  expect(screen.getByText("「规则校验」").tagName).toBe("STRONG");
  expect(view.container.querySelector("code")).toHaveTextContent('**“代码原样”**');
  expect(screen.getByText('**“保留星号”**')).toBeInTheDocument();
  expect(content).toContain('**“清晰排版与结构”**目标');
});
it("cleans generated guide annotations while retaining code and leaving personal notes untouched", () => {
  const content = "保留完整结论[e12]。\n\n`const e12 = [e3]`";
  const generated = render(<ReaderGuide content={content} zh complete hideEvidenceMarkers />);
  expect(screen.getByText("保留完整结论。")).toBeInTheDocument();
  expect(screen.getByText("const e12 = [e3]")).toBeInTheDocument();
  generated.unmount();
  render(<ReaderGuide content={content} zh complete />);
  expect(screen.getByText("保留完整结论[e12]。")).toBeInTheDocument();
});
it("renders grounded flow steps and comparison tables, leaving invalid flow and ordinary code intact", () => {
  const view = render(<ReaderGuide zh complete content={'```atlas-flow\n原始问题\n修正条件\n得出结论\n```\n\n| 方案 | 成本 |\n| --- | --- |\n| 复用 | 低 |\n\n```js\nconst value = 1;\n```\n\n```atlas-flow\nonly one step\n```'} />);
  expect(view.container.querySelector(".reading-flow")?.textContent).toContain("修正条件");
  expect(screen.getByRole("table")).toHaveTextContent("成本");
  expect(view.container.querySelector("pre code.language-js")).toHaveTextContent("const value = 1;");
  expect(view.container.querySelector("pre code.language-atlas-flow")).toHaveTextContent("only one step");
});

it("presents all ten explicit stages horizontally while retaining inline formatting and source order", () => {
  const labels = ["欢迎页", "对话确认", "方案草稿", "零件/旧物识别", "缺件清单", "Canvas", "AI老师式Validator", "仿真", "接线代码", "调试"];
  const content = `**十阶段用户旅程：**\n\n${labels.map((label, index) => `${index + 1}. ${index === 5 ? "`Canvas`" : index === 2 ? "**方案草稿**" : label}`).join("\n")}`;
  const { container } = render(<ReaderGuide content={content} zh complete />);
  const flow = container.querySelector(".reading-stage-flow");
  expect(flow?.querySelectorAll("li")).toHaveLength(10);
  expect(Array.from(flow?.querySelectorAll("li") ?? []).map(li => li.textContent)).toEqual(labels);
  expect(flow?.querySelector("code")).toHaveTextContent("Canvas");
  expect(flow?.querySelector("strong")).toHaveTextContent("方案草稿");
  expect(flow).toHaveAttribute("start", "1");
  expect(content).toContain("10. 调试");
});

it("shows a list whose items open on a bold stage label as stage cards, whatever sentence precedes it", () => {
  const stages = ["**第一阶段**：实现本地全文索引、消息定位及跨对话搜索，不依赖 LLM。", "**第二阶段**：加入 Embedding 语义检索，支持模糊记忆描述。", "**第三阶段**：引入 AI 答案生成与来源追溯，无明确证据时直接告知用户。"];
  const { container, rerender } = render(<ReaderGuide content={`质量评估按下面的顺序推进。\n\n${stages.map((stage, index) => `${index + 1}. ${stage}`).join("\n")}`} zh complete hideEvidenceMarkers />);
  expect(container.querySelectorAll(".reading-stage-flow.is-labelled li")).toHaveLength(3);
  // The name is the card's title: the "：" joining it to the text goes.
  expect(container.querySelector(".reading-stage-flow li strong")).toHaveTextContent("第一阶段");
  expect(container.querySelector(".reading-stage-flow li")?.textContent).toBe("第一阶段实现本地全文索引、消息定位及跨对话搜索，不依赖 LLM。");
  // Two labelled stages are cards too.
  rerender(<ReaderGuide content={"1. **早期招募**：找 10 位用户。\n2. **v0.2**：正式发布。"} zh complete hideEvidenceMarkers />);
  expect(container.querySelector(".reading-stage-flow")).toBeNull();
  rerender(<ReaderGuide content={"1. **v0.1**：找 10 位用户。\n2. **v0.2**：正式发布。"} zh complete hideEvidenceMarkers />);
  expect(container.querySelectorAll(".reading-stage-flow.is-labelled li")).toHaveLength(2);
  // Bold labels that name no stage stay an ordinary list.
  rerender(<ReaderGuide content={"注意事项。\n\n1. **注意**：保留原文。\n2. **提示**：先预览。\n3. **说明**：不自动发送。"} zh complete hideEvidenceMarkers />);
  expect(container.querySelector(".reading-stage-flow")).toBeNull();
});

it("keeps ordinary lists, long explanations, nested lists, quotations and code in their original form", () => {
  const content = "重要结论：\n\n1. 清晰\n2. 简单\n3. 可复习\n\n步骤说明：\n\n1. " + "完整条件".repeat(24) + "\n2. 确认\n3. 保存\n\n流程：\n\n1. 开始\n   - 保留子项\n2. 检查\n3. 结束\n\n> 阶段：\n>\n> 1. 开始\n> 2. 检查\n> 3. 结束\n\n```text\n阶段：\n1. 开始\n2. 检查\n3. 结束\n```";
  const { container } = render(<ReaderGuide content={content} zh complete />);
  expect(container.querySelector(".reading-stage-flow")).toBeNull();
  expect(container.querySelector("blockquote ol")).toHaveTextContent("开始 检查 结束");
  expect(container.querySelector("pre code")).toHaveTextContent("1. 开始");
  expect(container).toHaveTextContent("完整条件".repeat(24));
});

it("preserves an explicit starting stage number and renders ten-step atlas-flow without a code box", () => {
  const { container, rerender } = render(<ReaderGuide content={"后续步骤：\n\n7. 检查\n8. 仿真\n9. 保存"} zh complete />);
  expect(container.querySelector(".reading-stage-flow")).toHaveAttribute("start", "7");
  rerender(<ReaderGuide content={'```atlas-flow\n' + Array.from({ length: 10 }, (_, index) => `阶段 ${index + 1}`).join("\n") + '\n```'} zh complete />);
  expect(container.querySelectorAll(".reading-stage-flow li")).toHaveLength(10);
  expect(container.querySelector("pre")).toBeNull();
});

it("folds a generated history block and opens chapters from in-text links",()=>{
 const content="当前定位是项目工作区。\n\n> **演变记录**\n>\n> 早期曾视为 Wiki 生成器。\n\n> 这部分已在[「系统架构」](#atlas-chapter-a%201)中说明。";
 const view=render(<ReaderGuide content={content} zh complete hideEvidenceMarkers/>);
 const history=view.container.querySelector("details.wiki-history")!;
 expect(history).not.toBeNull();expect(history.querySelector("summary")).toHaveTextContent("演变记录");expect(history).toHaveTextContent("早期曾视为 Wiki 生成器。");
 expect(history.hasAttribute("open")).toBe(false);
 let opened:string|undefined;const listener=(event:Event)=>{opened=(event as CustomEvent<string>).detail;};
 window.addEventListener("atlas:open-chapter",listener);
 fireEvent.click(screen.getByRole("link",{name:"「系统架构」"}));
 window.removeEventListener("atlas:open-chapter",listener);
 expect(opened).toBe("a 1");
 // A quoted note that is not a generated history block stays a quotation.
 view.rerender(<ReaderGuide content={"> **演变记录**\n>\n> 用户原话。"} zh complete/>);
 expect(view.container.querySelector("details")).toBeNull();
});


it("keeps a report's headings, bullets, scoped states and comparison table accessible without rewriting content",()=>{
 const text="## 阅读方式\n\n**已决定**保留原始顺序。\n\n- 关键词查找不调用模型。\n- AI 建议增加语义增强，尚未确认。\n\n| 方案 | 状态 | 条件 |\n| --- | --- | --- |\n| 本地查找 | 已决定 | 无需密钥 |\n| 语义增强 | 建议 | 用户选择后启用 |";
 const view=render(<ReaderGuide content={text} zh complete/>);
 expect(screen.getByRole("heading",{name:"阅读方式"})).toBeVisible();
 expect(view.container.querySelectorAll("li")).toHaveLength(2);
 const region=screen.getByRole("region",{name:"表格，可横向滚动"});expect(region).toHaveAttribute("tabindex","0");
 expect(region.querySelectorAll("tbody tr")).toHaveLength(2);
 expect(region).toHaveTextContent("用户选择后启用");expect(view.container).toHaveTextContent("尚未确认");
});

it("shows an arrowed run of steps as a strip and sets a long paragraph's first sentence apart, keeping every character", () => {
  const flow = "侧边栏流程为：找到相关消息 -> 用户确认/选择 -> 生成上下文 -> 插入当前 AI。第一版不实时监视。";
  const long = "采用侧边栏为默认入口、按需展开分屏与完整工作台的三级阅读体验。" + "宽屏模式下左侧保留对话，右侧展示 Atlas 历史详情，实现双栏同时可读且无需跳转，两边互不遮挡。".repeat(3);
  const { container } = render(<ReaderGuide content={`${flow}\n\n${long}\n\n1. **第一层**：浏览只展示最需要的信息。\n2. **第二层**：详情展示完整内容。\n3. **第三层**：编辑展示修改操作。`} zh complete hideEvidenceMarkers />);
  expect([...container.querySelectorAll(".reading-inline-flow-step")].map(step => step.textContent)).toEqual(["找到相关消息", "用户确认/选择", "生成上下文", "插入当前 AI"]);
  // The written arrows stay in the text.
  expect(container.querySelector(".reading-inline-flow")?.parentElement?.textContent).toBe(flow);
  expect(container.querySelector(".reading-lead")?.textContent).toBe("采用侧边栏为默认入口、按需展开分屏与完整工作台的三级阅读体验。");
  // Layers read as stage cards.
  expect(container.querySelectorAll(".reading-stage-flow.is-labelled li")).toHaveLength(3);
});

it("folds a knowledge card's recall question, its answer a click away",()=>{
 const content="### 条件判断 · 已会\n\nif/elif/else 从上往下判断。\n\n> **回忆**：多个条件都为 True 时，执行哪一个？\n>\n> if/elif/else 从上往下判断，遇到第一个 True 即停止。";
 const {container}=render(<ReaderGuide content={content} zh complete hideCitationAnnotations/>);
 const recall=container.querySelector("details.wiki-recall") as HTMLDetailsElement;
 expect(recall.open).toBe(false);
 expect(recall.querySelector(".wiki-recall-question")?.textContent).toBe("多个条件都为 True 时，执行哪一个？");
 expect(recall.querySelector(".wiki-recall-answer")?.textContent).toContain("遇到第一个 True 即停止");
 expect(container.querySelector("blockquote")).toBeNull();
});
it("shows a block's caption as a header bar naming only what it is, with a tag only when it is not just AI's",()=>{
 const view=render(<ReaderGuide content={"*界面草图 · 首页布局引导 · AI 建议*\n\n```text\n今日任务 0/1\n[我已完成]\n```\n\n*只是强调的一句话*"} zh complete/>);
 const bar=view.container.querySelector(".wiki-block-caption")!;
 expect(bar.querySelector(".wiki-block-caption-kind")).toHaveTextContent("界面草图");
 expect(bar).toHaveTextContent(/^界面草图$/);
 expect(view.container.querySelector(".wiki-block-caption-place, .wiki-block-caption-whose")).toBeNull();
 // Emphasis that is no caption stays emphasis.
 expect(view.container.querySelectorAll(".wiki-block-caption")).toHaveLength(1);
});
it("still shows the caption bar when the chapter view linked its section name",()=>{
 const view=render(<ReaderGuide content={"*目录结构 · [AI Agent逻辑](#x) · AI建议*\n\n```text\nsrc/\n  agent.ts\n```"} zh complete/>);
 const bar=view.container.querySelector(".wiki-block-caption")!;
 expect(bar.querySelector(".wiki-block-caption-kind")).toHaveTextContent("目录结构");
 expect(bar).toHaveTextContent(/^目录结构$/);
});
it("tags a block you confirmed in its caption bar",()=>{
 const view=render(<ReaderGuide content={"*界面文案 · 首页 · 你确认*\n\n```text\n今日任务\n```"} zh complete/>);
 expect(view.container.querySelector(".wiki-block-caption-whose.is-mine")).toHaveTextContent("你确认");
});
it("reads a caption saved as the block's kind alone, and leaves other lone emphasis before a block alone",()=>{
 const view=render(<ReaderGuide content={"*流程*\n\n```text\n免费评估\n→ 付费解锁\n```\n\n*代码 · 你确认 · 以你后来的决定为准：只支持美元*\n\n```ts\nconst a = 1;\n```\n\n*看下面这段*\n\n```text\nx\n```"} zh complete/>);
 const bars=view.container.querySelectorAll(".wiki-block-caption");
 expect(bars).toHaveLength(2);
 expect(bars[0]).toHaveTextContent(/^流程$/);
 expect(bars[1].querySelector(".wiki-block-caption-note")).toHaveTextContent("以你后来的决定为准：只支持美元");
});

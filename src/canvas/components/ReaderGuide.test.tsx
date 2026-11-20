import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ReaderGuide } from "./ReaderGuide";
import { structureCode } from "../../test/structure-metadata-fixture";
import {leakedClaims} from "../../test/claims-prose-fixture";
afterEach(cleanup);
it("renders long workflow labels once, in reading order, for responsive wrapping", () => {
 const steps = ["选择待发布的项目", "核对发布说明", "Review notifications", "等待构建并检查完整的文件清单", "提交发布"];
 const {container} = render(<ReaderGuide content={`流程：${steps.join(" → ")}`} zh complete hideEvidenceMarkers />);
 const card = container.querySelector(".wiki-flow-card");
 expect(Array.from(card?.querySelectorAll("ol > li") ?? [], step => step.textContent)).toEqual(steps);
 expect(screen.getAllByText(steps.at(-1)!)).toHaveLength(1);
});
it("does not give an observation list or a context-dependent chain a made-up flow title", () => {
 const lists = "Landing page views → Trial clicks → Retention → Return visits [Proposal]";
 const chain = "你的应用 → 加载文件 → 校验数据 → 打开结果〔建议〕";
 const {container} = render(<ReaderGuide content={lists+"\n\n"+chain} zh complete hideEvidenceMarkers />);
 expect(container.querySelector(".wiki-flow-card")).toBeNull();
 expect(container).toHaveTextContent("Trial clicks");
 expect(container).toHaveTextContent("校验数据");
});
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

it("keeps embedded flows and long paragraph emphasis unchanged", () => {
  const flow = "侧边栏流程为：找到相关消息 -> 用户确认/选择 -> 生成上下文 -> 插入当前 AI。第一版不实时监视。";
  const long = "采用侧边栏为默认入口、按需展开分屏与完整工作台的三级阅读体验。" + "宽屏模式下左侧保留对话，右侧展示 Atlas 历史详情，实现双栏同时可读且无需跳转，两边互不遮挡。".repeat(3);
  const { container } = render(<ReaderGuide content={`${flow}\n\n${long}\n\n1. **第一层**：浏览只展示最需要的信息。\n2. **第二层**：详情展示完整内容。\n3. **第三层**：编辑展示修改操作。`} zh complete hideEvidenceMarkers />);
  expect(container.querySelector(".reading-inline-flow")).toBeNull();
  // The written arrows stay in the text.
  expect(container.textContent).toContain(flow);
  expect(container.querySelector(".reading-lead")).toBeNull();
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
it("renders optional source examples collapsed without enabling arbitrary HTML", () => {
 const mark=String.fromCharCode(96).repeat(3),source=mark+'ts\nconst literal = "此前建议";\n\n\nconst id = 7;\n'+mark;
 const content='<details data-atlas="atlas-wiki-supplement">\n<summary>补充资料 · 代码示例</summary>\n\n'+source+'\n\n</details>\n\n<script>window.bad=true</script>';
 const view=render(<ReaderGuide content={content} zh complete hideEvidenceMarkers/>);
 const details=view.container.querySelector('details.wiki-source-supplement');
 expect(details).not.toBeNull(); expect(details).not.toHaveAttribute('open');
 expect(details?.querySelector('summary')).toHaveTextContent('补充资料 · 代码示例');
 expect(details?.querySelector('summary .wiki-supplement-chevron')).toHaveAttribute('aria-hidden','true');
 expect(details?.querySelector('code')).toBeNull();
 (details as HTMLDetailsElement).open=true;fireEvent(details!,new Event('toggle'));
 expect(details?.querySelector('code')?.textContent).toBe('const literal = "此前建议";\n\n\nconst id = 7;\n');
 (details as HTMLDetailsElement).open=false;fireEvent(details!,new Event('toggle'));
 expect(details?.querySelector('code')).toBeNull();
 expect(view.container.querySelector('script')).toBeNull();
});

it("leaves quoted, incomplete and scope-conflict workflows as readable prose", () => {
 const content='> 范围有分歧：「Concept Preview 接口」写为不做，又建议「Plan → Preview → Confirm → A…」。\n\n“Plan → Preview → Confirm → Apply”是引用。\n\nPlan → Preview → Confirm → A…';
 const view=render(<ReaderGuide content={content} zh complete/>);
 expect(view.container.querySelector('.reading-inline-flow')).toBeNull();
 expect(view.container.textContent).toContain('Plan → Preview → Confirm → A…');
});

it("keeps a complete mixed-language workflow inside the steps without cutting an identifier",()=>{
 const content='作为示意，产品主链为：自然语言/零件盒/照片识别 → 需求理解与方案规划 → Hardware IR + Validator -> Canvas可视化工作区。该链路聚焦低压模块。';
 const view=render(<ReaderGuide content={content} zh complete/>);
 const steps=[...view.container.querySelectorAll('.reading-inline-flow-step')].map(step=>step.textContent);
 expect(steps).toEqual([]);
 expect(view.container.textContent).toBe(content);
});
it("shows short stages as compact steps and displays parameter colors without fake action buttons",()=>{
 const content="执行流程：\n\n1. 输入需求\n2. 理解需求\n3. 确认清单\n4. 生成方案\n5. 校验\n6. 提交\n\n| 项目 | 内容 |\n| --- | --- |\n| Background | `#FAFAFA` |\n\nAdd component · Run validation · Toggle theme";
 const view=render(<ReaderGuide content={content} zh complete hideEvidenceMarkers/>);
 expect(view.container.querySelector('.reading-stage-flow')).toHaveClass('is-compact');
 expect([...view.container.querySelectorAll('.reading-stage-flow li')].map(node=>node.textContent)).toEqual(['输入需求','理解需求','确认清单','生成方案','校验','提交']);
 expect(view.container.querySelector('.reader-color-swatch')).toHaveStyle({backgroundColor:'#FAFAFA'});
 expect(view.container.querySelector('td code')).toHaveTextContent('#FAFAFA');
 expect(screen.queryByRole('button',{name:'Add component'})).toBeNull();
});

it("keeps a deployment introduction outside the actual flow steps",()=>{
 const content='部署路径首选 GitHub → Vercel → Next.js/API Routes → LLM。';
 const view=render(<ReaderGuide content={content} zh complete/>);
 expect([...view.container.querySelectorAll('.reading-inline-flow-step')].map(node=>node.textContent)).toEqual(['GitHub','Vercel','Next.js/API Routes','LLM']);
 expect(view.container.textContent).toBe(content);
});

it("does not bind explanatory prose into an unbreakable flow step or turn acceptance checks into stages",()=>{
 const text='修改分两级：简单操作直接应用，复杂操作预览后应用，所有操作后必须经过 Transaction->Schema->Validator->Commit 流程。';
 const view=render(<ReaderGuide content={text+'\n\n完整流程的验收场景：\n\n1. 无密钥可用\n2. 失败不得写入\n3. 仅确认后提交'} zh complete/>);
 expect(view.container.querySelector('.reading-inline-flow-step')).toBeNull();
 expect(view.container.querySelectorAll('.reading-inline-flow-arrow')).toHaveLength(3);
 expect(view.container.querySelector('p')?.textContent).toBe(text);
 expect(view.container.querySelector('.reading-stage-flow')).toBeNull();
 expect(view.container.querySelectorAll('ol li')).toHaveLength(3);
});

it("renders a grouped source attachment with named examples while preserving original code",()=>{
 const mark=String.fromCharCode(96).repeat(3),content='<details data-atlas="atlas-wiki-supplement">\n<summary>原文与示例 · 2 项</summary>\n\n#### 1. 布局示例\n\n'+mark+'text\n┌ 输入 ┐\n'+mark+'\n\n#### 2. 命令示例\n\n'+mark+'sh\nnpm run check\n'+mark+'\n\n</details>';
 const view=render(<ReaderGuide content={content} zh complete hideEvidenceMarkers/>);
 expect(view.container.querySelectorAll('.wiki-source-supplement')).toHaveLength(1);
 expect(view.container.querySelector('details')).not.toHaveAttribute('open');
 const details=view.container.querySelector('details')!;details.open=true;fireEvent(details,new Event('toggle'));
 expect(screen.getByText('1. 布局示例')).toBeInTheDocument();expect(screen.getByText('2. 命令示例')).toBeInTheDocument();
 expect(view.container.querySelector('code.language-sh')).toHaveTextContent('npm run check');
});

it("renders long, short and legacy example captions as identical heading elements without touching code",()=>{
 const fence=(text:string)=>'```ts\n'+text+'\n```';
 const code='interface Example {\n  label: "原文不改";\n}';
 const content='<details data-atlas="atlas-wiki-supplement">\n<summary>原文与示例 · 3 项</summary>\n\n1. JSON 示例 · this is a much longer source title for testing\n\n'+fence('const x = 1;')+'\n\n**2. 数据结构 · interface Example {**\n\n'+fence(code)+'\n\n3. **流程示例 · User**\n\n'+fence('User')+'\n\n</details>';
 const view=render(<ReaderGuide content={content} zh complete hideEvidenceMarkers/>);
 const details=view.container.querySelector('details')!;details.open=true;fireEvent(details,new Event('toggle'));
 const titles=view.container.querySelectorAll('.wiki-source-supplement h4');
 expect(titles).toHaveLength(3);expect([...titles].every(title=>!title.querySelector('strong'))).toBe(true);
 expect(view.container.querySelectorAll('.wiki-source-supplement pre code')[1].textContent).toBe(code+'\n');
 expect(view.container.querySelector('.wiki-source-supplement ol')).toBeNull();
});
it("shows prose color values with swatches and palettes as compact fields, preserving identifiers and code",()=>{
 const mark=String.fromCharCode(96).repeat(3);
 const content='背景使用 #FAFAFA，边框用 #E8E8E8，文字为 `#18181B`。\n\n提交 `#abc123`，工单 #123，链接 [原文](https://example.com/#abc123)。\n\n| 用途 | 色值 |\n| --- | --- |\n| Background | `#FAFAFA` |\n| Border | `#E8E8E8` |\n\n'+mark+'css\n.panel { color: #18181B; }\n'+mark;
 const view=render(<ReaderGuide content={content} zh complete hideEvidenceMarkers/>);
 expect(view.container.querySelectorAll('.reader-color-swatch')).toHaveLength(5);
 expect(view.container.querySelector('.reader-palette')).not.toBeNull();expect(view.container.querySelectorAll('.reader-palette-entry')).toHaveLength(2);
 expect([...view.container.querySelectorAll('.reader-palette-entry dt')].map(node=>node.textContent)).toEqual(['Background','Border']);
 expect(view.container.querySelector('code.language-css')).toHaveTextContent('.panel { color: #18181B; }');
 expect(view.container.querySelector('code.language-css .reader-color-swatch')).toBeNull();
 expect(view.container.textContent).toContain('工单 #123');expect(view.container.querySelector('a')).toHaveAttribute('href','https://example.com/#abc123');
});

it("does not interpret arbitrary hash identifiers as a palette",()=>{
 const content='| Issue | Identifier |\n| --- | --- |\n| a | #abc123 |\n| b | #def456 |';
 const view=render(<ReaderGuide content={content} zh complete hideEvidenceMarkers/>);
 expect(view.container.querySelector('.reader-palette')).toBeNull();expect(view.container.querySelector('.reader-color-swatch')).toBeNull();
});
it("retains alternative color values while giving each value its own swatch",()=>{
 const content='背景可用 #FCFCFC/#FFFFFF。Canvas：`#FCFCFC / #FFFFFF`。';
 const view=render(<ReaderGuide content={content} zh complete hideEvidenceMarkers/>);
 expect(view.container.querySelectorAll('.reader-color-swatch')).toHaveLength(4);
 expect(view.container.textContent).toBe(content.replaceAll('`',''));
});
it("keeps nearby issue and commit identifiers literal even in a paragraph about colors",()=>{
 const content='背景使用 #FAFAFA，工单 #123，提交 `#abc123`，配色见 Issue #456。';
 const view=render(<ReaderGuide content={content} zh complete hideEvidenceMarkers/>);
 expect(view.container.querySelectorAll('.reader-color-swatch')).toHaveLength(1);
 expect(view.container.textContent).toBe(content.replaceAll('`',''));
});
it("adds only discretionary breaks to long technical names and leaves links and fenced code literal",()=>{
 const token='unsupportedOrUnsafe=true',mark=String.fromCharCode(96).repeat(3);
 const content='返回 '+token+'，禁止加入 Inventory。字段 `'+token+'`。\n\n[原文](https://example.com/'+token+')\n\n'+mark+'ts\n'+token+'\n'+mark;
 const view=render(<ReaderGuide content={content} zh complete/>);
 const spans=view.container.querySelectorAll('.reader-token');expect(spans).toHaveLength(2);
 expect([...spans].map(node=>node.textContent)).toEqual([token,token]);
 expect(spans[0].querySelectorAll('wbr')).toHaveLength(3);expect(spans[0].querySelector('br')).toBeNull();
 expect(view.container.querySelector('a wbr')).toBeNull();expect(view.container.querySelector('pre wbr')).toBeNull();
 expect(view.container.querySelector('pre code')).toHaveTextContent(token);
});

it("wraps slash-separated technical terms at separators without splitting ordinary English names or changing copied text",()=>{
 const text='由 AI 从 Component Catalog 选取元件，输出 JSON 经 Zod/Validator/Store 渲染至 Canvas。';
 const view=render(<ReaderGuide content={text} zh complete/>);
 expect(view.container.textContent).toBe(text);
 const token=view.container.querySelector('.reader-token')!;
 expect(token.textContent).toBe('Zod/Validator/Store');expect(token.querySelectorAll('wbr')).toHaveLength(2);
 expect([...token.childNodes].map(node=>node.textContent)).toEqual(['Zod/','','Validator/','','Store']);
 expect(view.container.querySelector('br')).toBeNull();
});
it("places a titled generated sequence in a card without promoting inline changes", () => {
  const text = "**Incident response workflow**: Intake → Assign owner → Contain → Verify [Proposal]\n\nThreshold update: CPU → 80%.";
  const { container, rerender } = render(<ReaderGuide content={text} zh={false} complete hideEvidenceMarkers />);
  const card = container.querySelector("figure.wiki-flow");
  expect(card?.querySelector("figcaption")?.textContent).toContain("Incident response workflow");
  expect([...card?.querySelectorAll("li") ?? []].map(item => item.textContent)).toEqual(["Intake", "Assign owner", "Contain", "Verify"]);
  expect(card?.querySelector("figcaption")?.textContent).not.toContain("Proposal");
  expect(container.querySelectorAll(".wiki-flow")).toHaveLength(1);
  expect(screen.getByText("Threshold update: CPU → 80%.")).toBeVisible();
  rerender(<ReaderGuide content={text} zh={false} complete />);
  expect(container.querySelector(".wiki-flow")).toBeNull();
});

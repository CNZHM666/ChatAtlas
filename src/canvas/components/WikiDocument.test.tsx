import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WikiDocument } from "./WikiDocument";
import {WikiChapterBody} from "./WikiChapterOverview";
import { projectSession } from "../../test/project-fixture";
import { WorkspaceEvidenceContext } from "../workspace-evidence-context";
import { ProjectKnowledgeActions } from "../project-knowledge-actions";
import { wikiBlocks } from "../../shared/wiki-explanations";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
// Distinct explanations: a chapter's repeated sentences and paragraphs are dropped before reading.
const TOPICS=[
 "原始消息保存在本地数据库中，每条消息带有稳定的会话编号和消息编号。导入失败时保留已经成功的批次，重启后可以继续。删除消息时先删除原始记录，再同步删除派生的索引条目。数据库版本变化时会先备份旧数据，再执行迁移，迁移失败可以回退到上一版本。附件和图片只保存引用信息，原文中的代码块按语言标识单独保存，未知类型降级为纯文本显示。批量导入时界面显示已完成的对话数量，用户可以随时取消，取消后已保存的对话仍然可以搜索和阅读。",
 "检索先在本地全文索引中查找关键词，再按需要合并语义结果。结果按消息聚合，避免同一对话刷屏。语义模型没有加载时，界面照常显示关键词结果。查询会记录所用索引的版本，模型更换后旧向量不会与新向量混在一起比较，需要重新建立索引。搜索框为空时显示最近的对话，输入时延迟一小段时间再查询，以免每敲一个字就触发一次检索。点击结果后阅读页滚动到对应消息并高亮匹配片段，同时显示前后两条消息，帮助判断这段话出现时的上下文。",
 "导出只包含用户选择的章节和总览，不附带完整数据库。个人修改过的章节按原样导出，不做任何改写。未勾选来源时，导出文件只写明结论可以在应用里回到原文核对。导出格式包括 Markdown、HTML、纯文本和 JSON，四种格式的内容保持一致。文件名取自项目名称，非法字符会被替换，过长的名称会被截断到九十个字符以内。导出前会显示所选章节数量和是否附带来源摘录，用户确认后才生成文件，生成过程中可以取消操作。",
 "阅读页默认只显示标题、正文和来源，编辑控件收在单独的入口里。左侧目录使用简短名称，完整标题在悬停时显示。窄屏下目录折叠到顶部按钮中，正文宽度随窗口调整。滚动区域只有正文一层，避免出现多层滚动条，键盘焦点在切换章节后回到正文开头。深色模式下的配色单独定义，代码块和引用块在两种模式下都保持足够的对比度，打印时隐藏导航。来源标记点击后在右侧面板展示原文，面板关闭后阅读位置保持不变，便于继续往下阅读同一章节。",
 "扩展发布前要在每个支持的平台上手工验收导入、查找和插入。权限只申请当前功能需要的范围。商店说明写清哪些数据保存在本地、哪些会发送给用户配置的模型服务。版本号只在用户确认发布后更新，变更说明列出新增功能和已知限制，回滚包在发布前准备好。用户反馈集中记录在一个表格里，按影响范围排序，每周复查一次是否需要修复版本。发布说明同时提供中文和英文两种语言，截图使用示例数据，不包含任何真实的私人对话内容。",
];
it("emphasizes supported phrases in late subtopics consistently in Reader and preview",()=>{
 const session=projectSession(),phrases=Array.from({length:5},(_,index)=>`模块${index}保留自己的来源条件`),section={...session.sections[0],body:phrases.map((phrase,index)=>`## 主题${index}\n\n${phrase}。\n\n${TOPICS[index]}`).join("\n\n"),claims:phrases.map(text=>({text,quote:session.evidence[0].excerpt,evidenceIds:[session.evidence[0].id]}))};
 const before=structuredClone(section),view=render(<WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/>);
 expect([...view.container.querySelectorAll(".chapter-guide strong")].map(node=>node.textContent)).toEqual(phrases);
 view.rerender(<WikiChapterBody section={section} zh/>);expect([...view.container.querySelectorAll("strong")].map(node=>node.textContent)).toEqual(phrases);expect(section).toEqual(before);
});
it("replaces page contents with quiet main-section navigation, preserving nested prose", () => {
 const session=projectSession(),section={...session.sections[0],body:"## 执行逻辑\n\n### 当前状态\n\n#### 验证记录\n\n## 密钥管理\n\n### 安全边界"};
 render(<WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/>);
 expect(screen.queryByText("页内目录")).toBeNull();
 const menu=screen.getByRole("navigation",{name:"本章快捷导航"});
 expect(within(menu).getAllByRole("button")).toHaveLength(2);
 expect(screen.getByText("验证记录")).toBeVisible();expect(screen.queryByRole("heading",{name:"验证记录"})).toBeNull();
 const target=within(menu).getByRole("button",{name:"密钥管理"}),heading=screen.getByRole("heading",{name:"密钥管理"}),scroll=vi.fn();
 Object.defineProperty(heading,"scrollIntoView",{value:scroll});
 fireEvent.pointerEnter(menu);expect(menu).toHaveClass("is-expanded");
 fireEvent.click(target);expect(heading).toHaveFocus();expect(scroll).toHaveBeenCalledWith({block:"start",behavior:"smooth"});expect(menu).not.toHaveClass("is-expanded");expect(target).toHaveAttribute("aria-current","location");
 fireEvent.focus(within(menu).getByRole("button",{name:"执行逻辑"}));expect(menu).toHaveClass("is-expanded");
 fireEvent.keyDown(menu,{key:"Escape"});expect(heading).toHaveFocus();expect(menu).not.toHaveClass("is-expanded");
});
it("positions a requested subtopic without searching or generating content",()=>{
 const session=projectSession(),section={...session.sections[0],body:"当前说明。\n\n## 数据存储\n\n原文保留。"};
 const view=render(<WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/>),heading=screen.getByRole("heading",{name:"数据存储"}),scroll=vi.fn();Object.defineProperty(heading,"scrollIntoView",{value:scroll});
 view.rerender(<WikiDocument headingTarget={{title:"数据存储",revision:1}} section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/>);
 expect(scroll).toHaveBeenCalledWith({block:"start",behavior:"auto"});expect(document.activeElement).toBe(heading);
});
it("does not inject a diagram generation card into technical Wiki prose",()=>{
 const session=projectSession(),section={...session.sections[0],title:"系统架构",body:"当前架构说明。\n\n## 模块职责\n\n检索模块返回消息级结果。"},before=structuredClone(session),save=vi.fn();
 render(<ProjectKnowledgeActions.Provider value={{save,read:vi.fn(),matter:vi.fn()}}><WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/></ProjectKnowledgeActions.Provider>);
 expect(screen.queryByText("适合添加架构图")).toBeNull();expect(screen.queryByRole("button",{name:/生成.*图解|Generate.*diagram/iu})).toBeNull();expect(screen.getByText("检索模块返回消息级结果。")).toBeVisible();expect(save).not.toHaveBeenCalled();expect(session).toEqual(before);
});
it("passes chapter scope to the shared source sidebar when no sentence can be matched to a source",()=>{
 const session=projectSession(),ref=session.evidence[0],open=vi.fn();
 session.evidence.push({...ref,id:"foreign",messageId:"other"});
 session.sections[0].claims=[];session.sections[0].body="这一章的文字和任何来源都对不上，所以没有可核对的点。";
 render(<WorkspaceEvidenceContext.Provider value={{open}}><WikiDocument section={session.sections[0]} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/></WorkspaceEvidenceContext.Provider>);
 fireEvent.click(screen.getByRole("button",{name:"核对依据"}));
 expect(open).toHaveBeenCalledWith(ref,expect.objectContaining({sectionId:session.sections[0].id,references:[ref]}));
});
it("marks each claim in the prose and opens only that claim's originals, point by point",()=>{
 const session=projectSession(),ref=session.evidence[0],open=vi.fn();
 const first={...ref,id:"p1",messageId:"m-first",excerpt:"先在本地检索候选消息。"},second={...ref,id:"p2",messageId:"m-second",excerpt:"基础搜索不依赖付费模型。"};
 session.evidence.push(first,second);
 const section={...session.sections[0],body:"Atlas 先在本地检索候选消息，再按需调用模型。其他说明不带依据。基础搜索不依赖付费模型，没有密钥也能用。",claims:[
  {text:"基础搜索不依赖付费模型",quote:"基础搜索不依赖付费模型。",evidenceIds:["p2"],formulations:["基础搜索不依赖付费模型"]},
  {text:"先在本地检索候选消息",quote:"先在本地检索候选消息。",evidenceIds:["p1"],formulations:["先在本地检索候选消息"]},
 ]};
 const view=render(<WorkspaceEvidenceContext.Provider value={{open}}><WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/></WorkspaceEvidenceContext.Provider>);
 const markers=[...view.container.querySelectorAll<HTMLElement>(".wiki-claim-marker")];
 // Reading order, not claim order: the first sentence's claim is point 1.
 expect(markers.map(marker=>marker.dataset.claimKey)).toEqual([`${section.id}:1`,`${section.id}:0`]);
 expect(markers[0].previousSibling?.textContent).toContain("再按需调用模型。");
 fireEvent.click(markers[1]);
 // Its original is found, so it needs no answer: it opens alone, not as one of every sentence to step through.
 expect(open).toHaveBeenLastCalledWith(second,expect.objectContaining({references:[second],quote:"基础搜索不依赖付费模型。",pointIndex:0,points:[expect.objectContaining({claim:"基础搜索不依赖付费模型",placed:true})]}));
 expect(open.mock.lastCall?.[1]).not.toHaveProperty("sectionId");
 // Both quotes are in their originals: nothing is left to review, and the button still browses every point.
 fireEvent.click(screen.getByRole("button",{name:"原文已定位"}));
 expect(open).toHaveBeenLastCalledWith(first,expect.objectContaining({pointIndex:0}));
});
it("checks quotes against the originals and reviews only the points that need a look",()=>{
 const session=projectSession(),open=vi.fn();
 const found={...session.evidence[0],id:"p1",messageId:"m1",excerpt:"先在本地检索候选消息。"},missing={...session.evidence[0],id:"p2",messageId:"m2",excerpt:"另一段讨论。"};
 session.evidence.push(found,missing);
 const section={...session.sections[0],body:"Atlas 先在本地检索候选消息。基础搜索不依赖付费模型。",claims:[
  {text:"先在本地检索候选消息",quote:"先在本地检索候选消息。",evidenceIds:["p1"],formulations:["先在本地检索候选消息"]},
  {text:"基础搜索不依赖付费模型",quote:"基础搜索不依赖付费模型。",evidenceIds:["p2"],formulations:["基础搜索不依赖付费模型"]},
 ]};
 render(<WorkspaceEvidenceContext.Provider value={{open}}><WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/></WorkspaceEvidenceContext.Provider>);
 fireEvent.click(screen.getByRole("button",{name:"核对依据 · 1 条待确认"}));
 const options=open.mock.lastCall![1];
 expect(open.mock.lastCall![0]).toBe(missing);
 expect(options.points).toHaveLength(1);
 expect(options.points[0]).toMatchObject({claim:"基础搜索不依赖付费模型",attention:{kind:"missing"}});
});
it("marks the active point while the panel shows it",()=>{
 const session=projectSession(),ref={...session.evidence[0],id:"p1",messageId:"m1",excerpt:"先在本地检索候选消息。"};session.evidence.push(ref);
 const section={...session.sections[0],body:"Atlas 先在本地检索候选消息。",claims:[{text:"先在本地检索候选消息",quote:"先在本地检索候选消息。",evidenceIds:["p1"],formulations:["先在本地检索候选消息"]}]};
 const point={key:`${section.id}:0`,claim:"先在本地检索候选消息",source:"other" as const,reference:ref,references:[ref],placed:true};
 const view=render(<WorkspaceEvidenceContext.Provider value={{open:vi.fn(),active:{points:[point],pointIndex:0}}}><WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/></WorkspaceEvidenceContext.Provider>);
 expect(view.container.querySelector(".wiki-claim-marker")).toHaveAttribute("aria-current","true");
});
it("removes chapter management and note entries while retaining editing and original data", () => {
 const session=projectSession(), section={...session.sections[0],body:"原始结论。[e16:1]-[e16:10], [e17:1]-[e17:10]"}, edit=vi.fn();
 const original=structuredClone(section);
 const view=render(<WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()} onEdit={edit}/>);
 expect(screen.queryByText(/e16:1/)).toBeNull();
 expect(screen.queryByText("章节更多操作")).toBeNull();expect(screen.queryByText("章节笔记与补充")).toBeNull();expect(screen.queryByText("维护相关知识")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"编辑"}));expect(edit).toHaveBeenCalledOnce();expect(section).toEqual(original);
 view.rerender(<WikiDocument section={{...section,userEdited:true}} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/>);
 expect(screen.queryByText(/e16:1/)).toBeNull();
 expect(section).toEqual(original);
 expect(session.notes).toBe("我的笔记");
});
it("hides legacy citation numbers and orphan punctuation in personal prose without changing its source",()=>{
 const session=projectSession(),section={...session.sections[0],userEdited:true,body:"- 10 名真实测试者 [e15]。\n- 关注真实价值：不追求 Star 数，。\n- 面向社区发布 。\n\n代码：`[e15]，。`\n\n[真实链接](https://example.com/e15)"};
 const original=structuredClone(section);
 render(<WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/>);
 expect(screen.getByText("10 名真实测试者。")).toBeVisible();
 expect(screen.getByText("关注真实价值：不追求 Star 数。")).toBeVisible();
 expect(screen.getByText("面向社区发布。")).toBeVisible();
 expect(screen.getByText("[e15]，。").tagName).toBe("CODE");
 expect(screen.getByRole("link",{name:"真实链接"})).toHaveAttribute("href","https://example.com/e15");
 expect(section).toEqual(original);
});
it("keeps real proposed updates accessible without a chapter menu",()=>{
 const session=projectSession(),section=session.sections[0];
 session.wikiSuggestions={[section.id]:{...section,body:"待采用的新讨论内容。"}};
 render(<WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"相关更新"}));expect(screen.getByText("待采用的新讨论内容。")).toBeVisible();
 expect(screen.queryByText("章节更多操作")).toBeNull();
});
it("keeps a missing historical reference warning without presenting an empty source module",()=>{
 const session=projectSession();session.evidence=[];const section={...session.sections[0],userEdited:true};
 render(<WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/>);
 expect(screen.getByText("已保存的历史来源暂不可定位。")).toBeVisible();expect(screen.queryByText("章节来源")).toBeNull();expect(section.evidenceIds).toEqual(["e1"]);
});
it("keeps a lead-in and its milestone list together before the optional chapter points", () => {
  const session = projectSession(), body = "**已完成阶段：**\n\n- **Milestone 1：** 完成界面。\n- **Milestone 2：** 完成核心流程。\n\n**下一阶段重点：**\n\n- 扩展校验。";
  render(<WikiDocument section={{ ...session.sections[0], body }} session={session} zh structure={<div>本章要点</div>} onLocate={vi.fn()} onCurrent={vi.fn()} />);
  const lead = screen.getByText("已完成阶段："), list = screen.getAllByRole("list")[0];
  expect(lead.closest("p")?.nextElementSibling).toBe(list);
  expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getAllByText("已完成阶段：")).toHaveLength(1);
  expect(screen.queryByText("本章要点")).toBeNull();
  expect(lead.closest(".chapter-guide")!.compareDocumentPosition(screen.getByText("下一阶段重点：")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("restores a brief chapter overview in Reader and preview without an independent Brief or duplicate opening",()=>{
 const session=projectSession(),body="本章解释视觉候选进入零件盒的流程，识别结果仍需用户确认。\n\n## 候选确认\n\n照片仅作为识别输入，不能创建未知元件。",section={...session.sections[0],body};
 session.brief=undefined;const original=structuredClone(section);
 const view=render(<WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/>);
 const overview=screen.getByRole("region",{name:"本章概览"});expect(within(overview).getByText("本章解释视觉候选进入零件盒的流程，识别结果仍需用户确认。")).toBeVisible();
 expect(screen.getAllByText("本章解释视觉候选进入零件盒的流程，识别结果仍需用户确认。")).toHaveLength(1);expect(screen.getByText((_,node)=>node?.tagName==="P"&&node.textContent==="照片仅作为识别输入，不能创建未知元件。")).toBeVisible();expect(section).toEqual(original);
 view.rerender(<WikiChapterBody section={section} zh/>);expect(screen.getByRole("region",{name:"本章概览"})).toBeVisible();expect(screen.getAllByText("本章解释视觉候选进入零件盒的流程，识别结果仍需用户确认。")).toHaveLength(1);
});
it("does not present two legacy child excerpts as a chapter overview in Reader or preview",()=>{
 const session=projectSession(),section={...session.sections[0],body:"## 竞品分析\n\n产品帮助恢复历史理解。\n\n## 产品定位\n\n产品帮助恢复过去的理解。"};
 const view=render(<WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/>);
 expect(screen.queryByRole("region",{name:"本章概览"})).toBeNull();expect(screen.getByText("产品帮助恢复历史理解。")).toBeVisible();expect(screen.getByText("产品帮助恢复过去的理解。")).toBeVisible();
 view.rerender(<WikiChapterBody section={section} zh/>);expect(screen.queryByRole("region",{name:"本章概览"})).toBeNull();expect(screen.queryByText(/节选自/)).toBeNull();
});
it("keeps the complete document and sources while navigating its main sections", () => {
  const session = projectSession(), section = { ...session.sections[0], wikiGroup: "技术架构", body: "当前方案。\n\n## 方案\n\n正文一。\n\n## 原因\n\n正文二。\n\n## 限制\n\n正文三。", claims: [{ text: "关键结论", quote: "原句", evidenceIds: ["e1"] }] };
  render(<WikiDocument section={section} session={session} zh structure={<div>保留结构图</div>} onLocate={vi.fn()} onCurrent={vi.fn()} />);
  expect(screen.queryByText("本章图解与个人理解")).toBeNull();expect(screen.queryByText("保留结构图")).toBeNull();expect(screen.getByText("来源与原始讨论")).toBeVisible();
  expect(screen.getAllByText("当前方案。")).toHaveLength(1);
  expect(screen.getByText("正文三。")).toBeVisible();
  expect(screen.queryByText("原句")).not.toBeInTheDocument();
  const menu = screen.getByRole("navigation", { name: "本章快捷导航" });
  expect(within(menu).getAllByRole("button")).toHaveLength(3);
  const heading = screen.getByRole("heading", { name: "限制" });
  const scroll = vi.fn(); Object.defineProperty(heading, "scrollIntoView", { value: scroll });
  fireEvent.click(within(menu).getByRole("button", { name: "限制" }));
  expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
  expect(heading).toHaveFocus(); expect(menu).not.toHaveClass("is-expanded");
});
it("keeps project editing focused on title and prose without diagram supplements or settings", () => {
  const session = projectSession();
  const finish = vi.fn();
  render(<WikiDocument section={session.sections[0]} session={session} zh structure={<div>结构图</div>} editor={<textarea aria-label="正文编辑" defaultValue="个人修改" />} onLocate={vi.fn()} onCurrent={vi.fn()} onFinishEdit={finish} />);
  expect(screen.getByRole("textbox", { name: "正文编辑" })).toHaveValue("个人修改");
  expect(screen.queryByText("结构图")).toBeNull();expect(screen.queryByText("编辑图解与章节补充")).toBeNull();expect(screen.queryByText("更多设置")).toBeNull();
  expect(screen.queryByText("关键结论依据")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "保存并结束编辑" }));
  expect(finish).toHaveBeenCalledOnce();
});
it("shows chapter evolution as a compact card whose marker opens the record's own source",()=>{
 const session=projectSession(),open=vi.fn();
 session.projectEvolutionAnalysis={version:6,kind:"evolution",events:[{id:"history:plan",title:"操作计划",version:"",before:"直接生成采购清单",after:"先生成操作计划再确认",reason:"避免误买零件",status:"documented",decisionStatus:"confirmed",quote:"",evidenceIds:["e1"],beforeQuote:"",beforeEvidenceIds:[]}],evidence:session.evidence,sources:[],signature:"s",sourceSignature:"s",generatedAt:1};
 const section={...session.sections[0],body:"当前说明。\n\n**历史：**早期 AI 讨论中曾提出 MCP Adapter，但后续评估指出这些来自早期 AI建议。"};
 const view=render(<WorkspaceEvidenceContext.Provider value={{open}}><WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/></WorkspaceEvidenceContext.Provider>);
 expect(view.container.textContent).not.toContain("**");expect(screen.queryByText(/MCP Adapter/)).toBeNull();
 const card=view.container.querySelector(".wiki-history-card")!;
 expect(card).not.toHaveAttribute("open");expect(within(card as HTMLElement).getByText("1 条")).toBeInTheDocument();
 expect(card.textContent).toContain("此前直接生成采购清单");expect(card.textContent).toContain("现在先生成操作计划再确认");expect(card.textContent).toContain("用户决定");
 fireEvent.click(card.querySelector(".wiki-claim-marker")!);
 expect(open).toHaveBeenCalledWith(expect.objectContaining({id:"e1"}),expect.objectContaining({claim:"直接生成采购清单 → 先生成操作计划再确认"}));
});
it("takes the reader to each sentence naming a stance no cited message backs",()=>{
 const session=projectSession(),ref={...session.evidence[0],id:"p1",messageId:"m1",excerpt:"首页只保留搜索入口。"};session.evidence.push(ref);
 const proposal=(text:string)=>({text,quote:ref.excerpt,evidenceIds:["p1"],workStatus:"proposed" as const});
 const section={...session.sections[0],body:"首页只保留搜索入口。\n\n用户明确要求侧栏默认收起。\n\n导出提供 Markdown。",claims:[proposal("首页只保留搜索入口"),proposal("导出提供 Markdown")]};
 const view=render(<WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/>);
 const notice=screen.getByRole("button",{name:/正文有 1 处写到你的表态/u});
 fireEvent.click(notice);
 const target=view.container.querySelector(".is-stance-target");
 expect(target?.textContent).toContain("用户明确要求侧栏默认收起");
});
it("adds a claim whose meaning the originals do not carry to the review, with the reason",()=>{
 const session=projectSession(),open=vi.fn(),ref={...session.evidence[0],id:"p1",messageId:"m1",excerpt:"可以考虑用 Orama 做全文索引。"};session.evidence.push(ref);
 const section={...session.sections[0],body:"已确定采用 Orama 做全文索引。",claims:[{text:"已确定采用 Orama 做全文索引",quote:"可以考虑用 Orama 做全文索引。",evidenceIds:["p1"],formulations:["已确定采用 Orama 做全文索引"]}]};
 render(<WorkspaceEvidenceContext.Provider value={{open}}><WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/></WorkspaceEvidenceContext.Provider>);
 fireEvent.click(screen.getByRole("button",{name:"核对依据 · 1 条待确认"}));
 expect(open.mock.lastCall![1].points[0].attention).toMatchObject({kind:"tentative"});expect(open.mock.lastCall![1].mode).toBe("check");
});
it("highlights in the document the claims that cite the original the panel shows",()=>{
 const session=projectSession(),first={...session.evidence[0],id:"p1",messageId:"m1",excerpt:"先在本地检索候选消息。"},second={...session.evidence[0],id:"p2",messageId:"m2",excerpt:"基础搜索不依赖付费模型。"};
 session.evidence.push(first,second);
 const section={...session.sections[0],body:"Atlas 先在本地检索候选消息。基础搜索不依赖付费模型。",claims:[
  {text:"先在本地检索候选消息",quote:"先在本地检索候选消息。",evidenceIds:["p1"],formulations:["先在本地检索候选消息"]},
  {text:"基础搜索不依赖付费模型",quote:"基础搜索不依赖付费模型。",evidenceIds:["p2"],formulations:["基础搜索不依赖付费模型"]},
 ]};
 const view=render(<WorkspaceEvidenceContext.Provider value={{open:vi.fn(),active:{shown:second}}}><WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/></WorkspaceEvidenceContext.Provider>);
 const highlighted=[...view.container.querySelectorAll<HTMLElement>("[data-claim-highlighted]")].map(marker=>marker.dataset.claimKey);
 expect(highlighted).toEqual([`${section.id}:1`]);
});
it("hides source highlighting until the reader turns it on, and keeps semantic status labels either way",()=>{
 localStorage.removeItem("atlas-wiki-holder-marks-shown");
 const session=projectSession(),ref=session.evidence[0],text="原始消息保存在本地数据库中，每条消息带有稳定的会话编号。";
 const section={...session.sections[0],body:`${text}

${TOPICS[1]}`,evidenceIds:[ref.id],claims:[{text,quote:ref.excerpt,evidenceIds:[ref.id],holder:"decided" as const,holderMark:true}]};
 const view=render(<WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/>);
 const article=view.container.querySelector("article.wiki-document")!,toggle=screen.getByRole("button",{name:"显示出处"});
 // Off at first: the page reads as text, not as a sheet of tints.
 expect(article).toHaveClass("hides-holder-marks");expect(toggle).toHaveAttribute("aria-pressed","false");
 // The status label stays with the highlight hidden: it is the one place the status is said.
 expect(article.querySelector(".wiki-claim-marker.is-holder-mark")?.textContent).toBe("已定");
 fireEvent.click(toggle);
 expect(article).not.toHaveClass("hides-holder-marks");expect(screen.getByRole("button",{name:"收起出处"})).toHaveAttribute("aria-pressed","true");
 expect(localStorage.getItem("atlas-wiki-holder-marks-shown")).toBe("1");
 localStorage.removeItem("atlas-wiki-holder-marks-shown");
});
it("names a pending problem above the chapter, marks its paragraph and steps to the next",async()=>{
 const session=projectSession(),section={...session.sections[0],body:`${TOPICS[0]}\n\n${TOPICS[1]}`};
 const block=wikiBlocks(section)[1],step=vi.fn(),close=vi.fn();
 const view=render(<WikiDocument section={section} session={{...session,sections:[section]}} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()} issue={{issue:{code:"unsupported_status",sectionId:section.id,blockId:block.id,claimKeys:[],evidenceIds:[]},index:0,total:3}} onIssueStep={step} onIssueClose={close}/>);
 expect(screen.getByRole("status")).toHaveTextContent("待处理 1/3把没有确认的建议写成了已决定");
 await waitFor(()=>expect(view.container.querySelector("[data-issue-active]")?.textContent).toContain(TOPICS[1].slice(0,10)));
 // Only that paragraph: the first one, which opens differently, is not marked.
 expect(view.container.querySelectorAll("[data-issue-active]")).toHaveLength(1);
 expect(screen.getByRole("button",{name:"上一处"})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"下一处"}));expect(step).toHaveBeenCalledWith(1);
 fireEvent.click(screen.getByRole("button",{name:"关闭"}));expect(close).toHaveBeenCalled();
});

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WikiDocument } from "./WikiDocument";
import {WikiChapterBody} from "./WikiChapterOverview";
import { projectSession } from "../../test/project-fixture";
import { WorkspaceEvidenceContext, type WorkspaceEvidenceOptions } from "../workspace-evidence-context";
import { ProjectKnowledgeActions } from "../project-knowledge-actions";
import { wikiBlocks } from "../../shared/wiki-explanations";
import type { WikiKnowledgeUnit } from "../../shared/wiki-knowledge";
import { wikiTableSignature } from "../../shared/wiki-table-source";
import { wikiEvidencePoints } from "../wiki-evidence";
import { WikiDecisionCards } from "./WikiDecisionCards";
import { projectOverviewWorkspace } from "../project-overview-workspace";
import { documentEvidenceReview } from "../document-review";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("keeps chapter material in its reading order without a discussion fold", () => {
 const session=projectSession();
 const first="新增记录先进入草稿。", second="同一草稿可以附上原始记录。", proposal="AI 建议在记录上添加颜色。";
 const section={...session.sections[0],body:[first,second,proposal].join("\n\n"),
  claims:[{text:second,quote:second,holder:"material" as const,evidenceIds:["e1"],holderMark:true}]};
 session.sections=[section];
 session.evidence=[{...session.evidence[0],excerpt:second}];
 session.wikiKnowledge={version:1,generatedAt:1,status:"complete",materials:1,batches:[],
  draft:{version:1,generatedAt:1,status:"complete",chapters:[],report:{},writingMode:"concise"}};
 render(<WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/>);
 const content=screen.getByRole("article",{name:"Wiki 文档"});
 const text=content.textContent??"";
 expect(text).toContain(first);
 expect(text.indexOf(second)).toBeGreaterThan(text.indexOf(first));
 expect(content).toHaveTextContent(/AI\s*建议在记录上添加颜色。/u);
 expect(screen.queryByText("讨论与历史")).toBeNull();
 const source = screen.getByText("来源与原始讨论");
 expect(source).toBeVisible();
 expect(source.closest(".wiki-chapter-content")).toBe(content.querySelector(".chapter-guide")?.closest(".wiki-chapter-content"));
});

it("keeps adoption in the decision footer and puts optional actions in the overflow menu", () => {
 const question={id:"release",kind:"version" as const,text:"采用哪个发布范围？",basis:[],mergeable:true,
  options:[{id:"first",label:"先发布基础版本",unitIds:["a"]},{id:"second",label:"与高级版本一并发布",unitIds:["b"]}]};
 const save=vi.fn(async()=>undefined);
 const {container}=render(<ProjectKnowledgeActions.Provider value={{save,read:vi.fn(),matter:vi.fn()}}>
  <WikiDecisionCards questions={[question]} session={projectSession()} zh onLocate={vi.fn()}/>
 </ProjectKnowledgeActions.Provider>);
 fireEvent.click(screen.getByText(question.text));
 const adopt=screen.getByRole("button",{name:"确认选择"});
 const menu=container.querySelector(".knowledge-more")!;
 expect(adopt).toBeDisabled();
 expect(menu).not.toHaveAttribute("open");
 fireEvent.click(screen.getByRole("radio",{name:"先发布基础版本"}));
 expect(adopt).toBeEnabled();
 fireEvent.click(menu.querySelector("summary")!);
 expect(menu).toHaveAttribute("open");
 expect(within(menu as HTMLElement).getByRole("button",{name:"暂缓"})).toBeVisible();
 expect(screen.getByRole("button",{name:"合并方案"})).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"自定义决定"}));
 expect(screen.getByRole("textbox",{name:"写下当前决定"})).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"取消"}));
 expect(screen.getByRole("button",{name:"确认选择"})).toBeEnabled();
});

it("opens uncited decision options from the footer and groups excerpts of the same original message", () => {
 const session = projectSession();
 const source = session.sourceConversationIds[0];
 const statements = ["缺件清单展示元件用途。", "缺件清单附上搜索关键词。", "缺件清单可以复制。"];
 const units: WikiKnowledgeUnit[] = statements.map((statement, index) => ({
   id: `u${index}`, subject: "缺件清单", statement, kind: "plan", details: [], adoption: { status: "proposal" }, delivery: "unknown",
   evidence: { evidenceId: `e${index}`, conversationId: source, messageId: index === 2 ? "second" : "first", messageIndex: index === 2 ? 2 : 1,
     role: "assistant", pasted: false, quote: statement },
 }));
 session.sourceVersionIds = { [source]: "snapshot" };
 session.sourceSignatures = { [source]: { first: "first-signature", second: "second-signature" } };
 session.evidence = [{ id: "quoted", conversationId: source, messageId: "second", title: "设计讨论", excerpt: statements[2], sourceVersionId: "snapshot" }];
 session.wikiKnowledge = { version: 1, generatedAt: 1, materials: 2, status: "complete",
   batches: [{ sourceIds: [], status: "ok", units, rejected: {} }] };
 const data = projectOverviewWorkspace(session, true, undefined, [
   { id: "options", question: "缺件清单怎么展示？", kind: "topic", options: units.map(unit => ({ id: unit.id, label: unit.statement, unitIds: [unit.id] })) },
 ])!;
 const locate = vi.fn();
 const { container } = render(<ProjectKnowledgeActions.Provider value={{ save: vi.fn(async () => undefined), read: vi.fn(), matter: vi.fn() }}>
   <WikiDecisionCards questions={data.questions} session={session} zh onLocate={locate} />
 </ProjectKnowledgeActions.Provider>);
 fireEvent.click(screen.getByText("缺件清单怎么展示？"));
 const footer = within(container.querySelector<HTMLElement>(".wiki-decision-actions")!);
 expect(footer.getAllByRole("button", { name: /^来源/u })).toHaveLength(2);
 expect(footer.getByRole("button", { name: "确认选择" })).toBeInTheDocument();
 expect(screen.queryByRole("button", { name: "原话" })).toBeNull();
 fireEvent.click(footer.getByRole("button", { name: "来源 1" }));
 expect(locate).toHaveBeenCalledWith(expect.objectContaining({ messageId: "first", sourceVersionId: "snapshot" }),
   expect.objectContaining({ sourcePassages: statements.slice(0, 2).map(quote => ({ referenceId: "decision-source:u0", quote })) }));
 fireEvent.click(footer.getByRole("button", { name: "来源 2" }));
 expect(locate).toHaveBeenLastCalledWith(session.evidence[0], expect.objectContaining({ quote: statements[2] }));
});

it("opens a generated table citation in the sidebar at its exact evidence, including matching message numbers across conversations",()=>{
 const session=projectSession(),open=vi.fn();
 const table="| 组件 | 职责 |\n|---|---|\n| Orama | 本地全文检索 |";
 const section={...session.sections[0],body:`### 组件\n\n${table}`,claims:[]};
 const ref={...session.evidence[0],excerpt:"Orama 负责本地全文检索。",id:"e:c:0:1"};
 const other={...ref,id:"e:other:0:1",conversationId:"other",messageId:"same-number-other-conversation"};
 section.evidenceIds=[ref.id,other.id];
 const unit:WikiKnowledgeUnit={id:"search",subject:"搜索",statement:ref.excerpt,kind:"fact",details:[],adoption:{status:"unknown"},delivery:"unknown",
  evidence:{evidenceId:ref.id,conversationId:ref.conversationId,messageId:ref.messageId,messageIndex:0,role:"assistant",pasted:false,quote:ref.excerpt,code:{language:"table",text:table}}};
 session.sections=[section];session.evidence=[other,ref];session.sourceConversationIds=[ref.conversationId,other.conversationId];
 session.wikiKnowledge={version:1,generatedAt:1,status:"complete",materials:1,batches:[{sourceIds:[ref.id],units:[unit],status:"ok",rejected:{}}]};
 render(<WorkspaceEvidenceContext.Provider value={{open}}><WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/></WorkspaceEvidenceContext.Provider>);
 const source=screen.getByRole("link",{name:"来源"});
 expect(source.closest(".wiki-table-heading")).toHaveTextContent(/组件.*职责/u);
 expect(screen.queryByText("原文来源")).toBeNull();
 fireEvent.click(source);
 expect(open).toHaveBeenCalledWith(ref,expect.objectContaining({tableTarget:wikiTableSignature(table),sectionId:section.id,mode:"view"}));
});
it("finds the full original of a reordered table even when the saved reference has no table metadata",()=>{
 const session=projectSession(),open=vi.fn();
 const table="| 模块 | 职责 |\n|---|---|\n| Orama | 本地全文检索 |\n| IndexedDB | 保存原文 |\n| Reader | 加载对话 |";
 const reordered="| 模块 | 职责 |\n|---|---|\n| `IndexedDB` | 保存原文 |\n| Orama | 本地全文检索 |";
 const ref={...session.evidence[0],excerpt:"原表如下。\n\n"+table};
 const section={...session.sections[0],body:reordered,evidenceIds:[ref.id],claims:[]};
 session.sections=[section];session.evidence=[ref];
 const renderChapter=(active?: Parameters<typeof open>[1])=><WorkspaceEvidenceContext.Provider value={{open,active}}>
   <WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/>
 </WorkspaceEvidenceContext.Provider>;
 const view=render(renderChapter());
 fireEvent.click(screen.getByRole("link",{name:"来源"}));
 expect(open).toHaveBeenCalledWith(ref,expect.objectContaining({tableTarget:wikiTableSignature(table),structuredBlock:true}));
 view.rerender(renderChapter(open.mock.calls[0][1]));
 expect(screen.getByRole("table")).toHaveAttribute("data-wiki-structure-active","true");
 view.rerender(renderChapter());
 expect(screen.getByRole("table")).not.toHaveAttribute("data-wiki-structure-active");
});
// Distinct explanations: a chapter's repeated sentences and paragraphs are dropped before reading.
const TOPICS=[
 "原始消息保存在本地数据库中，每条消息带有稳定的会话编号和消息编号。导入失败时保留已经成功的批次，重启后可以继续。删除消息时先删除原始记录，再同步删除派生的索引条目。数据库版本变化时会先备份旧数据，再执行迁移，迁移失败可以回退到上一版本。附件和图片只保存引用信息，原文中的代码块按语言标识单独保存，未知类型降级为纯文本显示。批量导入时界面显示已完成的对话数量，用户可以随时取消，取消后已保存的对话仍然可以搜索和阅读。",
 "检索先在本地全文索引中查找关键词，再按需要合并语义结果。结果按消息聚合，避免同一对话刷屏。语义模型没有加载时，界面照常显示关键词结果。查询会记录所用索引的版本，模型更换后旧向量不会与新向量混在一起比较，需要重新建立索引。搜索框为空时显示最近的对话，输入时延迟一小段时间再查询，以免每敲一个字就触发一次检索。点击结果后阅读页滚动到对应消息并高亮匹配片段，同时显示前后两条消息，帮助判断这段话出现时的上下文。",
 "导出只包含用户选择的章节和总览，不附带完整数据库。个人修改过的章节按原样导出，不做任何改写。未勾选来源时，导出文件只写明结论可以在应用里回到原文核对。导出格式包括 Markdown、HTML、纯文本和 JSON，四种格式的内容保持一致。文件名取自项目名称，非法字符会被替换，过长的名称会被截断到九十个字符以内。导出前会显示所选章节数量和是否附带来源摘录，用户确认后才生成文件，生成过程中可以取消操作。",
 "阅读页默认只显示标题、正文和来源，编辑控件收在单独的入口里。左侧目录使用简短名称，完整标题在悬停时显示。窄屏下目录折叠到顶部按钮中，正文宽度随窗口调整。滚动区域只有正文一层，避免出现多层滚动条，键盘焦点在切换章节后回到正文开头。深色模式下的配色单独定义，代码块和引用块在两种模式下都保持足够的对比度，打印时隐藏导航。来源标记点击后在右侧面板展示原文，面板关闭后阅读位置保持不变，便于继续往下阅读同一章节。",
 "扩展发布前要在每个支持的平台上手工验收导入、查找和插入。权限只申请当前功能需要的范围。商店说明写清哪些数据保存在本地、哪些会发送给用户配置的模型服务。版本号只在用户确认发布后更新，变更说明列出新增功能和已知限制，回滚包在发布前准备好。用户反馈集中记录在一个表格里，按影响范围排序，每周复查一次是否需要修复版本。发布说明同时提供中文和英文两种语言，截图使用示例数据，不包含任何真实的私人对话内容。",
];
it("docks tools and cycles evidence of the selected status in reading order",()=>{
 const session=projectSession(),open=vi.fn(),host=document.createElement("div");
 const quotes=["默认保留全文检索。","导出文件保留原始引用。"];
 const section={...session.sections[0],body:quotes.join("\n\n"),claims:quotes.map((text,index)=>({text,quote:text,holder:"decided" as const,holderMark:true,evidenceIds:[`e${index}`]}))};
 session.sections=[section];
 session.evidence=quotes.map((text,index)=>({...session.evidence[0],id:`e${index}`,messageId:`m${index}`,excerpt:text}));
 const view=render(<><div ref={node=>{if(node&&!node.contains(host))node.append(host);}}/><WorkspaceEvidenceContext.Provider value={{open}}><WikiDocument toolsHost={host} section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/></WorkspaceEvidenceContext.Provider></>);
 expect(view.container.querySelector(".wiki-document .wiki-tool-rail")).toBeNull();
 const tools=within(host);
 const show=tools.queryByRole("button",{name:"显示出处"});
 if(show)fireEvent.click(show);
 const card=tools.getByRole("button",{name:"已定 2"});
 fireEvent.click(card);fireEvent.click(card);fireEvent.click(card);
 expect(open.mock.calls.map(([ref,opts])=>[ref.messageId,opts.pointIndex,opts.mode])).toEqual([["m0",0,"view"],["m1",1,"view"],["m0",0,"view"]]);
 localStorage.removeItem("atlas-wiki-holder-marks-shown");
});
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
 expect(screen.getByRole("heading",{name:"验证记录",level:4})).toBeVisible();
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
it("opens the source from the dedicated workflow heading",()=>{
 const session=projectSession(),open=vi.fn();
 const text="**事件响应流程**：记录事件 → 指派人员 → 核实影响 → 恢复服务〔建议〕";
 const statement=text.replace(/\*\*/gu,"");
 const source={...session.evidence[0],excerpt:statement};
 session.evidence=[source];
 const section={...session.sections[0],body:text,evidenceIds:[source.id],claims:[{text:statement,quote:statement,evidenceIds:[source.id]}]};
 const {container}=render(<WorkspaceEvidenceContext.Provider value={{open}}><WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/></WorkspaceEvidenceContext.Provider>);
 const button=screen.getByRole("link",{name:"来源"});
 expect(container.querySelector("figure.wiki-flow figcaption")).toContainElement(button);
 fireEvent.click(button);
 expect(open).toHaveBeenCalledWith(source,expect.objectContaining({quote:"记录事件 → 指派人员 → 核实影响 → 恢复服务",references:[source]}));
});
it("names a generic flow from its steps and locates an exact sequence without a claim marker",()=>{
 const session=projectSession(),open=vi.fn();
 const exact="记录回执 -> **分派工单** -> 校验材料 -> 归档结果";
 const basis={...session.evidence[0],excerpt:`参考步骤：${exact}。遇到异常需另行处理。`};
 const unrelated={...basis,id:"other-flow",messageId:"other-message",excerpt:"记录回执 → 分派工单 → 归档结果 → 校验材料"};
 const section={...session.sections[0],body:"**流程**：记录回执 → 分派工单 → 校验材料 → 归档结果〔建议〕",evidenceIds:[unrelated.id,basis.id],claims:[]};
 session.sections=[section];session.evidence=[unrelated,basis];
 render(<WorkspaceEvidenceContext.Provider value={{open}}><WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/></WorkspaceEvidenceContext.Provider>);
 const caption=screen.getByText("从记录回执到归档结果").closest("figcaption")!;
 expect(caption).not.toHaveTextContent("建议");
 fireEvent.click(within(caption).getByRole("link",{name:"来源"}));
 expect(open).toHaveBeenCalledWith(basis,expect.objectContaining({quote:exact,references:[basis]}));
});
it("never attaches a source to a flow from shared terms or reordered steps",()=>{
 const session=projectSession();
 const basis={...session.evidence[0],excerpt:"记录回执 → 校验材料 → 分派工单 → 归档结果"};
 const section={...session.sections[0],body:"**流程**：记录回执 → 分派工单 → 校验材料 → 归档结果〔建议〕",evidenceIds:[basis.id],claims:[]};
 session.sections=[section];session.evidence=[basis];
 render(<WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/>);
 const caption=screen.getByText("从记录回执到归档结果").closest("figcaption")!;
 expect(within(caption).getByText("来源待核对")).toBeVisible();
 expect(within(caption).queryByRole("link")).toBeNull();
});
it("locates the original ordered flow when the last step has a Wiki version annotation", () => {
 const session = projectSession(), open = vi.fn();
 const flow = "自然语言\n ↓\nHardware IR\n ↓\n自动生成画布\n ↓\nSimulation";
 const basis = { ...session.evidence[0], excerpt: flow };
 const other = { ...basis, id: "other-version", messageId: "other", excerpt: flow + " (v1)" };
 const section = { ...session.sections[0], body: "**流程**：自然语言 → Hardware IR → 自动生成画布 → Simulation（v0）〔建议〕", evidenceIds: [basis.id, other.id], claims: [] };
 session.sections = [section];
 session.evidence = [other, basis];
 render(<WorkspaceEvidenceContext.Provider value={{open}}><WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/></WorkspaceEvidenceContext.Provider>);
 fireEvent.click(screen.getByRole("link", { name: "来源" }));
 expect(open).toHaveBeenCalledWith(basis, expect.objectContaining({ quote: flow, references: [basis] }));
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
 // The markers keep chapter reading order even when the saved claims are reversed.
 expect(markers.map(marker=>marker.dataset.claimKey)).toEqual(wikiEvidencePoints(section,session.evidence,true).reverse().map(point=>point.key));
 expect(markers[0].previousSibling?.textContent).toContain("再按需调用模型。");
 fireEvent.click(markers[1]);
 // Its original is found, so it needs no answer: it opens alone, not as one of every sentence to step through.
 expect(open).toHaveBeenLastCalledWith(second,expect.objectContaining({references:[second],quote:"基础搜索不依赖付费模型。",pointIndex:0,points:[expect.objectContaining({claim:"基础搜索不依赖付费模型",placed:true})]}));
 expect(open.mock.lastCall?.[1]).not.toHaveProperty("sectionId");
 // Both quotes are in their originals: nothing is left to review, and the button still browses every point.
 fireEvent.click(screen.getByRole("button",{name:"来源已定位"}));
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
 const [point]=wikiEvidencePoints(section,session.evidence,true);
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
it("uses the evidence review without the retired stance confirmation bar",()=>{
 const session=projectSession(),ref={...session.evidence[0],id:"p1",messageId:"m1",excerpt:"首页只保留搜索入口。"};session.evidence.push(ref);
 const section={...session.sections[0],body:"用户明确要求侧栏默认收起。",claims:[{text:"用户明确要求侧栏默认收起",quote:ref.excerpt,evidenceIds:["p1"],workStatus:"proposed" as const}]};
 const open=vi.fn();
 render(<WorkspaceEvidenceContext.Provider value={{open}}><WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/></WorkspaceEvidenceContext.Provider>);
 expect(screen.queryByRole("button",{name:/正文有.*写到你的表态/u})).toBeNull();
 expect(screen.queryByText("表述符合我的意思")).toBeNull();expect(screen.queryByText("改写这句")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:/核对依据/u}));expect(open).toHaveBeenCalledOnce();
});
it("adds a claim whose meaning the originals do not carry to the review, with the reason",()=>{
 const session=projectSession(),open=vi.fn(),ref={...session.evidence[0],id:"p1",messageId:"m1",excerpt:"可以考虑用 Orama 做全文索引。"};session.evidence.push(ref);
 const section={...session.sections[0],body:"已确定采用 Orama 做全文索引。",claims:[{text:"已确定采用 Orama 做全文索引",quote:"可以考虑用 Orama 做全文索引。",evidenceIds:["p1"],formulations:["已确定采用 Orama 做全文索引"]}]};
 render(<WorkspaceEvidenceContext.Provider value={{open}}><WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/></WorkspaceEvidenceContext.Provider>);
 fireEvent.click(screen.getByRole("button",{name:"核对依据 · 1 条待确认"}));
 expect(open.mock.lastCall![1].points[0].attention).toMatchObject({kind:"tentative"});expect(open.mock.lastCall![1].mode).toBe("check");
});

it("counts only questions with visible Wiki text and highlights the active sentence before a decision is recorded", () => {
 const session = projectSession(), open = vi.fn();
 const visible = "已决定只加载本地消息。", hidden = "已决定上传全部对话副本。";
 const reference = { ...session.evidence[0], excerpt: "可以考虑只加载本地消息。也可以考虑上传全部对话副本。" };
 const section = { ...session.sections[0], body: `## 来源范围\n\n${visible}`, evidenceIds: [reference.id], claims: [
   { text: hidden, quote: "也可以考虑上传全部对话副本。", evidenceIds: [reference.id], workStatus: "proposed" as const },
   { text: visible, quote: "可以考虑只加载本地消息。", evidenceIds: [reference.id], workStatus: "proposed" as const, holder: "ai" as const },
 ] };
 session.sections = [section];
 session.evidence = [reference];
 expect(documentEvidenceReview(session, true)).toEqual([{ sectionId: section.id, count: 1 }]);
 const documentView = (active?: WorkspaceEvidenceOptions) => <WorkspaceEvidenceContext.Provider value={{ open, active }}>
   <WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()}/>
 </WorkspaceEvidenceContext.Provider>;
 const view = render(documentView());
 fireEvent.click(screen.getByRole("button", { name: "核对依据 · 1 条待确认" }));
 const active = open.mock.lastCall![1];
 expect(active.points).toHaveLength(1);
 expect(active.points[0]).toMatchObject({ claim: visible, attention: { kind: "settled", claimExcerpt: visible } });
 view.rerender(documentView(active));
 const marker = view.container.querySelector(".wiki-claim-marker");
 expect(marker).toHaveClass("is-active");
 expect(marker).toHaveAttribute("data-claim-highlighted", "true");
 expect(screen.queryByText(hidden)).toBeNull();
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
 expect(highlighted).toEqual(wikiEvidencePoints(section,session.evidence,true).filter(point=>point.reference===second).map(point=>point.key));
});
it("hides source highlighting until the reader turns it on, and keeps semantic status labels either way",()=>{
 localStorage.removeItem("atlas-wiki-holder-marks-shown");
 const session=projectSession(),ref=session.evidence[0],text="原始消息保存在本地数据库中，每条消息带有稳定的会话编号。";
 const section={...session.sections[0],body:`${text}

${TOPICS[1]}`,evidenceIds:[ref.id],claims:[{text,quote:ref.excerpt,evidenceIds:[ref.id],holder:"decided" as const,holderMark:true}]};
 const onLocate=vi.fn();
 const scroller=document.createElement("div");
 let visibleWidth=600;
 vi.spyOn(scroller,"getBoundingClientRect").mockImplementation(()=>new DOMRect(0,0,visibleWidth,640));
 const view=render(<WikiDocument section={section} session={session} zh scrollRef={{current:scroller}} structure={null} onLocate={onLocate} onCurrent={vi.fn()}/>);
 const article=view.container.querySelector("article.wiki-document")!,toggle=screen.getByRole("button",{name:"显示出处"});
 // Off at first: the page reads as text, not as a sheet of tints.
 expect(article).toHaveClass("hides-holder-marks");expect(toggle).toHaveAttribute("aria-pressed","false");
 // The status label stays with the highlight hidden: it is the one place the status is said.
 expect(article.querySelector(".wiki-claim-marker.is-holder-mark")?.textContent).toBe("已定");
 expect(screen.queryByRole("group",{name:"按状态查阅依据"})).toBeNull();
 expect(screen.queryByText("按状态查阅依据")).toBeNull();
 const control=toggle.parentElement!,panel=control.querySelector<HTMLElement>(".wiki-status-panel")!;
 let anchorLeft=260;
 vi.spyOn(control,"getBoundingClientRect").mockImplementation(()=>new DOMRect(anchorLeft,30,36,36));
 vi.spyOn(panel,"getBoundingClientRect").mockReturnValue(new DOMRect(0,0,210,80));
 fireEvent.click(toggle);
 expect(article).not.toHaveClass("hides-holder-marks");expect(screen.getByRole("button",{name:"收起出处"})).toHaveAttribute("aria-pressed","true");
 expect(panel).toBe(screen.getByRole("group",{name:"按状态查阅依据"}));
 expect(panel.dataset.placement).toBe("right");
 visibleWidth=390;
 fireEvent.resize(window);
 expect(panel.dataset.placement).toBe("left");
 visibleWidth=320;anchorLeft=150;
 fireEvent.resize(window);
 expect(panel.dataset.placement).toBe("below");
 expect(panel.style.getPropertyValue("--wiki-status-offset")).toBe("-142px");
 fireEvent.click(within(panel).getByRole("button",{name:"已定 1"}));
 expect(onLocate).toHaveBeenCalledWith(expect.objectContaining({id:ref.id}));
 expect(localStorage.getItem("atlas-wiki-holder-marks-shown")).toBe("1");
 fireEvent.keyDown(within(panel).getByRole("button",{name:"已定 1"}),{key:"Escape"});
 expect(panel).not.toBeVisible();
 expect(screen.getByRole("button",{name:"显示出处"})).toHaveFocus();
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

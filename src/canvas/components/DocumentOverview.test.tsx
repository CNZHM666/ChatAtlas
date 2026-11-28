import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import type { FocusSession } from "../../shared/focus-session";
import { ProjectKnowledgeActions } from "../project-knowledge-actions";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentOverview } from "./DocumentOverview";
import { KnowledgeLedger } from "./KnowledgeLedger";
import { contextKnowledge } from "../../test/context-fixture";
import { WorkspaceEvidenceContext } from "../workspace-evidence-context";
import type { WikiKnowledgeUnit } from "../../shared/wiki-knowledge";
import { sourceMessageSignature } from "../../shared/source-signature";
import { readSessionSource } from "../../storage/source-versions";

afterEach(cleanup);
vi.mock("../../storage/source-versions", async importOriginal => ({
 ...await importOriginal<typeof import("../../storage/source-versions")>(), readSessionSource: vi.fn(),
}));

it("keeps saved sidebar decisions with chapter links and leaves loose questions in their chapter", async () => {
 const session=contextKnowledge().session,onRead=vi.fn();
 const decided="首版只支持嵌入式固件。", question="首轮应该支持哪些 MCU？";
 const base=session.sections[0];
 session.sections.push({...base,id:"firmware",title:"固件范围",body:`${decided}\n\n${question}`,claims:[
  {text:decided,quote:"",evidenceIds:[],holder:"decided",userDecided:true,continuation:true},
  {text:question,quote:"",evidenceIds:[],holder:"open",continuation:true},
 ]});
 const view=render(<DocumentOverview session={session} zh onRead={onRead} onLocate={vi.fn()}/>);
 expect(view.container.querySelector(".project-overview-intro")).not.toHaveTextContent(question);
 expect(screen.queryByRole("region",{name:"待决问题"})).toBeNull();
 const decisions=within(screen.getByRole("region",{name:"已定的关键决定"}));
 const saved = await decisions.findByText(decided);
 fireEvent.click(within(saved.closest("li")!).getByRole("button",{name:"查看章节"}));
 expect(onRead).toHaveBeenCalledWith("firmware",undefined);
});
it("shows incomplete title editing and lets users review a suggested name without applying it automatically",()=>{
 const session=contextKnowledge().session,onRename=vi.fn();
 session.wikiTitleReview={version:2,status:"partial",requested:3,accepted:2,rejected:[{id:"c:0",reason:"missing"}]};
 session.wikiSuggestedTitle="项目知识助手";
 render(<DocumentOverview session={session} zh onRead={vi.fn()} onLocate={vi.fn()} onRename={onRename}/>);
 expect(screen.getByRole("status")).toHaveTextContent("已保留原名和正文");expect(onRename).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"检查名称"}));expect(onRename).toHaveBeenCalledWith("项目知识助手");
 expect(session.title).toBe("ChatAtlas");
});
it("keeps an untagged opening sentence quiet instead of presenting it as an automatic key conclusion",()=>{
 const session=contextKnowledge().session;session.brief=undefined;session.projectState=undefined;session.sections[0].title="产品定位";session.sections[0].body="ChatAtlas 是帮助用户找回历史讨论的本地知识助手。";
 const view=render(<DocumentOverview session={session} zh onRead={vi.fn()} onLocate={vi.fn()}/>);
 expect(view.container.querySelector(".project-overview-intro strong")).toBeNull();expect(view.container.querySelector(".project-overview-intro")).toHaveTextContent(session.sections[0].body);
});

it("places evidence and editing in the overview header toolbar and saves the description", async () => {
 const session=contextKnowledge().session,onMaintain=vi.fn().mockResolvedValue(undefined);
 session.brief=undefined;session.projectState=undefined;session.sections[0].title="产品定位";session.sections[0].body="ChatAtlas 是帮助用户找回历史讨论的本地知识助手。";
 const props={session,zh:true,onRead:vi.fn(),onLocate:vi.fn(),onMaintain};
 const view=render(<DocumentOverview {...props}/>);
 const tools=screen.getByRole("navigation",{name:"文档工具"});
 expect(tools).toHaveClass("overview-header-actions");
 expect(within(tools).getAllByRole("button").map(button=>button.getAttribute("aria-label"))).toEqual(["核对依据","编辑说明"]);
 const edit=within(tools).getByRole("button",{name:"编辑说明"});
 expect(view.container.querySelector(".project-overview-intro")).not.toContainElement(edit);
 fireEvent.click(edit);fireEvent.change(screen.getByRole("textbox",{name:"项目说明"}),{target:{value:"我的项目说明"}});fireEvent.click(screen.getByRole("button",{name:"保存"}));
 expect(onMaintain).toHaveBeenCalledWith({...session.projectMaintenance,overview:"我的项目说明"});
});

it("shows chapter summary cards with chapter questions available on hover tooltips", () => {
  const session = contextKnowledge().session, [first, second] = session.sections;
  session.sections = [first, ...Array.from({ length: 3 }, (_, i) => ({ ...first, id: `tech-${i}`, title: `存储细节${i}` })), second, ...Array.from({ length: 3 }, (_, i) => ({ ...second, id: `ui-${i}`, title: `界面细节${i}` }))];
  session.sections.forEach((section, index) => { section.wikiGroup = index < 4 ? "技术" : "界面"; section.wikiGroupEdited = true; });
  first.wikiQuestion = "原始消息保存在哪里？";
  const onRead = vi.fn();
  render(<DocumentOverview session={session} zh onRead={onRead} onLocate={vi.fn()} />);
  const index = within(screen.getByRole("region", { name: "一页速览" }));
  expect(index.getAllByRole("listitem")).toHaveLength(8);
  expect(index.getByText("01")).toBeVisible();
  expect(screen.queryByRole("button", { name: "查看来源对话" })).toBeNull();
  expect(index.queryByText("原始消息保存在哪里？")).toBeNull();
  const link = index.getByTitle("原始消息保存在哪里？");
  expect(link).toHaveTextContent(first.wikiDisplayTitle || first.title);
  fireEvent.click(link);
  expect(onRead).toHaveBeenCalledWith(first.id);
});

it("keeps one flat chapter list without a part count when all chapters share a part", () => {
  const session = contextKnowledge().session;
  for (const section of session.sections) { section.wikiGroup = "技术"; section.wikiGroupEdited = true; }
  render(<DocumentOverview session={session} zh onRead={vi.fn()} onLocate={vi.fn()} />);
  expect(screen.queryByText(/个部分/u)).toBeNull();
  expect(screen.queryByRole("region", { name: "技术" })).toBeNull();
  expect(screen.getByText("数据库存储")).toBeVisible();
});

it("lays out its heading and inline header tools cleanly",()=>{
 const session=contextKnowledge().session;session.brief=undefined;session.projectState=undefined;session.sections[0].title="产品定位";session.sections[0].body="ChatAtlas 是帮助用户找回历史讨论的本地知识助手。";
 const {container}=render(<DocumentOverview session={session} zh onRead={vi.fn()} onLocate={vi.fn()}/>);
 const row=container.querySelector(".document-overview-heading > .wiki-document-location")!;
 expect(row).toHaveTextContent("文档总览");expect(container.querySelector(".document-overview-heading > h1")).toHaveTextContent(session.title);
 const evidence=within(screen.getByRole("navigation",{name:"文档工具"})).getByRole("button",{name:"核对依据"});
 expect(evidence).toHaveAttribute("title","核对依据");
 expect(container.querySelector(".document-overview-heading small")).toBeNull();
});
it("keeps plan content without mounting sources and history in the overview",async()=>{
 const {session,messages}=contextKnowledge(),onLocate=vi.fn();
 const units:WikiKnowledgeUnit[]=[];
 const originals = [
  {text:"我们决定第一版采用本地全文搜索。",kind:"decision",role:"user",adoption:"user_decision",delivery:"unknown",time:Date.UTC(2026,9,12)},
  {text:"我们已经实现 Wiki 来源定位。",kind:"report",role:"user",adoption:"unknown",delivery:"user_reported",time:undefined},
  {text:"我们已经发布 Reader 第一版。",kind:"report",role:"user",adoption:"unknown",delivery:"user_reported",time:Date.UTC(2026,10,2)},
  {text:"下一步计划实现混合检索。",kind:"plan",role:"assistant",adoption:"proposal",delivery:"unknown",time:Date.UTC(2026,10,6)},
 ] as const;
 for(const [index,{text,kind,role,adoption,delivery,time}] of originals.entries()){
  const id=`step-${index}`, messageId=`original-${index}`;
  const info={conversationId:"c",messageId,role,messageIndex:messages.length};
  const quote=index===0?`${text.slice(0,-1)}，因为用户需要在本地快速找回对话。`:text;
  const signature=sourceMessageSignature(quote);
  session.evidence.push({id,conversationId:"c",messageId,title:"项目记录",excerpt:quote,sourceSignature:signature});
  session.sourceSignatures!.c[messageId]=signature;
  session.sourceRoles!.c[messageId]=role;
  messages.push({...messages[0],id:messageId,role,content:quote,messageIndex:info.messageIndex,sourceCreatedAt:time,createdAt:time??Date.UTC(2026,10,16)});
  units.push({id,subject:id,statement:text,kind,details:[],delivery,adoption:{status:adoption},
   evidence:{...info,evidenceId:id,pasted:false,quote}});
 }
 const primary=session.evidence.find(ref=>ref.id==="step-0")!;
 const repeat={...primary,id:"step-repeat",messageId:"original-repeat",excerpt:originals[0].text,sourceSignature:undefined};
 session.evidence.push(repeat);
 units.push({...units[0],id:repeat.id,evidence:{...units[0].evidence,evidenceId:repeat.id,messageId:repeat.messageId,messageIndex:messages.length,quote:repeat.excerpt}});
 session.wikiKnowledge={version:1,generatedAt:1,status:"complete",documentType:"project",materials:units.length,
  decisions:{"step-0":{verdict:"confirmed",at:Date.UTC(2026,10,16),wholeUnit:true}},
  draft:{version:1,generatedAt:1,status:"complete",chapters:[],report:{},baseline:[{part:"now",text:originals[0].text,unitIds:["step-0"]}]},
  batches:[{sourceIds:units.map(unit=>unit.id),status:"ok",rejected:{},units}]};
 session.projectMaintenance={currentPlan:"v0.1 先交付全文搜索。"};
 vi.mocked(readSessionSource).mockResolvedValue(messages);
 render(<DocumentOverview session={session} zh onRead={vi.fn()} onLocate={onLocate}/>);
 expect(screen.queryByRole("heading",{name:"下一步"})).toBeNull();
 expect(screen.getByRole("region",{name:"已定的关键决定"})).toBeInTheDocument();
 expect(within(screen.getByRole("region",{name:"已定的关键决定"})).getByText(originals[0].text)).toBeVisible();
 const plan=within(screen.getByRole("region",{name:"当前计划"}));
 expect(plan.getByText("v0.1 先交付全文搜索。")).toBeVisible();
 expect(plan.queryByText(originals[0].text)).toBeNull();
 expect(plan.queryByText(originals[3].text)).toBeNull();
 expect(screen.queryByRole("region",{name:"产品演进"})).toBeNull();
 expect(screen.queryByText("产品演进")).toBeNull();
 expect(screen.queryByText("来源与记录")).toBeNull();
 expect(readSessionSource).not.toHaveBeenCalled();
 expect(screen.queryByRole("region",{name:"当前规划"})).toBeNull();
});
it("checks overview statements point by point",()=>{
 const session=contextKnowledge().session,open=vi.fn();session.projectState=undefined;
 session.brief={summary:"ChatAtlas 先在本地用 IndexedDB 保存原始消息，再用 Orama 建立检索索引。",confirmed:[],turningPoints:[],openQuestions:[]} as unknown as typeof session.brief;
 const source={...session.evidence[0],id:"ov",messageId:"ov-msg",excerpt:"我们先在本地用 IndexedDB 保存原始消息，再用 Orama 建立检索索引。"};session.evidence.push(source);
 session.sections[0].claims=[{text:"a",quote:"a",evidenceIds:[source.id],workStatus:"proposed"}];
 const {container}=render(<WorkspaceEvidenceContext.Provider value={{open}}><DocumentOverview session={session} zh onRead={vi.fn()} onLocate={vi.fn()}/></WorkspaceEvidenceContext.Provider>);
 const button=screen.queryByRole("button",{name:/^核对依据 · \d+ 处$/u});
 expect(button).not.toBeNull();expect(container.querySelector(".wiki-claim-marker")).not.toBeNull();
 fireEvent.click(button!);expect(open).toHaveBeenCalledWith(source,expect.objectContaining({pointIndex:0,quote:"我们先在本地用 IndexedDB 保存原始消息，再用 Orama 建立检索索引。"}));
});

it("keeps a long confirmed plan folded and links directly to its Wiki chapter", async () => {
 const session = contextKnowledge().session, onRead = vi.fn();
 const section = session.sections[0];
 const text = "第一版用 DHT22 完成端到端验收。先识别零件，经用户确认后放入零件盘点，生成项目草稿后再更新画布。验证器需要分别检查连接关系和供电条件，验证失败时保留原项目，让用户查看失败原因后再重试。";
 const source = { id: "next-step", conversationId: "c", messageId: "next-original", title: "下一步讨论", excerpt: text };
 const unit: WikiKnowledgeUnit = { id: source.id, kind: "plan", statement: text, subject: "验收流程", details: [], adoption: { status: "user_decision" }, delivery: "planned",
   evidence: { conversationId: source.conversationId, messageId: source.messageId, evidenceId: source.id, messageIndex: 9, role: "user", pasted: false, quote: text } };
 session.evidence.push(source);
 section.claims = [{ text, quote: text, evidenceIds: [source.id], unitIds: [unit.id] }];
 session.wikiKnowledge = { version: 1, generatedAt: 1, status: "complete", documentType: "project", materials: 1,
   decisions: { [unit.id]: { verdict: "confirmed", at: 1, wholeUnit: true } },
   batches: [{ sourceIds: [source.id], status: "ok", rejected: {}, units: [unit] }],
   draft: { version: 1, generatedAt: 1, status: "complete", chapters: [], report: {}, baseline: [{ part: "now", text, unitIds: [unit.id] }] } };
 render(<DocumentOverview session={session} zh onRead={onRead} onLocate={vi.fn()}/>);
 const planRegion = within(screen.getByRole("region", { name: "当前计划" }));
 const plan = await planRegion.findByText(text);
 expect(plan).toBeVisible();
 fireEvent.click(within(plan.closest("li")!).getByRole("button", { name: "查看章节" }));
 expect(onRead).toHaveBeenCalledWith(section.id, undefined);
});

it("opens the user-authored source first and only highlights the clicked overview row", async () => {
 const session = contextKnowledge().session;
 const flow = "第一版用自然语言修改 Hardware IR。Canvas 随修改实时变化，并自动运行 Validator 检查。";
 const units: WikiKnowledgeUnit[] = ["AI 理解后修改 Hardware IR，Canvas 随之变化。", flow, "AI 提议暂缓视觉调整。"].map((statement, index) => ({
   id: `flow-${index}`, kind: "plan", subject: "执行链路", statement, details: [], adoption: { status: "proposal" }, delivery: "planned",
   evidence: { conversationId: "c", messageId: `original-${index}`, evidenceId: `cite-${index}`, messageIndex: index + 10, role: index ? "user" : "assistant", pasted: false, quote: index === 2 ? "![图片](<atlas-image:example>)\n現在怎麽樣" : statement },
 }));
 const sources = units.map(unit => ({ id: unit.evidence.evidenceId, conversationId: "c", messageId: unit.evidence.messageId, title: "执行安排", excerpt: unit.evidence.quote }));
 session.evidence.push(...sources);
 session.wikiKnowledge = { version: 1, generatedAt: 1, status: "complete", documentType: "project", materials: units.length,
   decisions: { "flow-1": { verdict: "confirmed", at: 1, wholeUnit: true } },
   batches: [{ sourceIds: sources.map(source => source.id), status: "ok", rejected: {}, units }],
   draft: { version: 1, generatedAt: 1, status: "complete", chapters: [], report: {}, baseline: [
     { part: "now", holder: "user", text: flow, unitIds: units.slice(0, 2).map(unit => unit.id) },
     { part: "done", text: "讨论 AI 建议的验收方式。", unitIds: [units[0].id] },
     { part: "notNow", holder: "user", text: units[2].statement, unitIds: [units[2].id] },
   ] } };
 const onLocate = vi.fn();
 const props = { session, zh: true, onLocate, onRead: vi.fn() };
 const view = render(<WorkspaceEvidenceContext.Provider value={{ open: onLocate }}><DocumentOverview {...props}/></WorkspaceEvidenceContext.Provider>);
 fireEvent.click(screen.getByText("当前计划"));
 const row = (await screen.findByText(flow)).closest("li")!;
 expect(screen.queryByText(units[2].statement)).toBeNull();
 fireEvent.click(within(row).getByRole("button", { name: "依据" }));
 expect(onLocate).toHaveBeenCalledWith(sources[1], expect.objectContaining({ claim: flow, quote: sources[1].excerpt, references: [sources[1]] }));
 view.rerender(<WorkspaceEvidenceContext.Provider value={{ open: onLocate, active: { ...onLocate.mock.calls[0][1], shown: sources[0] } }}><DocumentOverview {...props}/></WorkspaceEvidenceContext.Provider>);
 expect(row.querySelector("mark")).toHaveTextContent(flow);
 expect(view.container.querySelectorAll(".overview-active-claim")).toHaveLength(1);
 expect(within(row).getByRole("button", { name: "依据" })).toHaveAttribute("aria-pressed", "true");
 view.rerender(<WorkspaceEvidenceContext.Provider value={{ open: onLocate }}><DocumentOverview {...props}/></WorkspaceEvidenceContext.Provider>);
 expect(row.querySelector("mark")).toBeNull();
});

it("saves a sourced overview choice, defers another, and updates the displayed queue", async () => {
 const session = contextKnowledge().session;
 const choices = ["第一版仅支持全文搜索。", "第一版同时支持向量搜索。", "发布前需要运行测试。"];
 const units: WikiKnowledgeUnit[] = choices.map((statement, index) => ({
   id: "u" + index, kind: "plan", statement, subject: index === 2 ? "发布验收" : "搜索范围", details: [],
   adoption: { status: "proposal" }, delivery: "planned",
   evidence: { conversationId: "c", messageId: "overview-original-" + index, evidenceId: "overview-basis-" + index,
      messageIndex: 10 + index, role: "assistant", pasted: false, quote: statement },
 }));
 session.evidence.push(...units.map(unit => ({ id: unit.evidence.evidenceId, conversationId: "c", messageId: unit.evidence.messageId,
   excerpt: unit.evidence.quote, title: "讨论" })));
 session.wikiKnowledge = { version: 1, generatedAt: 1, status: "complete", documentType: "project", materials: 3,
   batches: [{ sourceIds: units.map(unit => unit.evidence.evidenceId), status: "ok", rejected: {}, units }],
   organization: { version: 1, generatedAt: 1, status: "complete", subjects: [{ id: "outline", name: "规划", aliases: [], unitIds: units.map(unit => unit.id) }],
     merged: [], relations: [], report: {}, chapters: [{ id: session.sections[0].id, question: "", title: session.sections[0].title, group: "", subtopics: [{title: "规划", subjectIds: ["outline"]}] }] },
   writingQuestions: [
     { id: "search", about: "搜索范围", ask: "第一版采用全文搜索还是也支持向量搜索？", unitIds: ["u0", "u1"], organization: 1, options: [
       { id: "text", label: choices[0], actions: [{ do: "confirm", units: ["u0"] }, { do: "reject", units: ["u1"] }] },
       { id: "hybrid", label: choices[1], actions: [{ do: "reject", units: ["u0"] }] },
     ] },
     { id: "tests", about: "发布验收", ask: "是否确定发布前需要运行测试？", unitIds: ["u2"], organization: 1, options: [
       { id: "test", label: choices[2], actions: [{ do: "confirm", units: ["u2"] }] }, { id: "defer", label: "暂不决定", actions: [{ do: "open", units: ["u2"] }] },
     ] },
   ],
 };
 let stored = session;
 const onLocate = vi.fn(), onRead = vi.fn();
 function Harness() {
   const [value, setValue] = useState(session);
   return <ProjectKnowledgeActions.Provider value={{ read: vi.fn(), matter: vi.fn(), save: async (change: (current: FocusSession) => FocusSession) => {
     stored = change(stored); setValue(stored);
   } }}><DocumentOverview session={value} zh onRead={onRead} onLocate={onLocate}/></ProjectKnowledgeActions.Provider>;
 }
 render(<Harness/>);
 const open = () => within(screen.getByRole("region", { name: "待决问题" }));
 expect(open().queryByText("是否确定发布前需要运行测试？")).toBeNull();
 fireEvent.click(open().getByText("查看全部待决问题"));
 expect(await open().findByText("是否确定发布前需要运行测试？")).toBeVisible();
 fireEvent.click(open().getByText("查看全部待决问题"));
 const question = open().getByText("第一版采用全文搜索还是也支持向量搜索？").closest("summary")!;
 const search = within(question.closest("details")!);
 expect(question.querySelector("svg")).toBeInTheDocument();
 expect(question.closest("details")).not.toHaveAttribute("open");
 fireEvent.click(question);
 const options = await search.findByRole("group", {name:"备选方案"});
 expect(within(options).getAllByRole("radio")).toHaveLength(2);
 expect(within(options).queryByRole("button")).toBeNull();
 expect(onLocate).not.toHaveBeenCalled();
 fireEvent.click(search.getByRole("button", {name:"来源 1"}));
 expect(onLocate).toHaveBeenCalledWith(session.evidence.at(-3), expect.objectContaining({ mode: "view", overviewEntryId: "search", references: [session.evidence.at(-3)] }));
 fireEvent.click(question);
 expect(question.closest("details")).not.toHaveAttribute("open");
 fireEvent.click(question);
 const confirm = await search.findByRole("button", {name:"确认选择"});
 expect(confirm).toBeDisabled();
 fireEvent.click(search.getByRole("radio", {name:choices[0]}));
 expect(stored.wikiKnowledge?.userAnswers).toBeUndefined();
 fireEvent.click(confirm);
 await waitFor(() => expect(open().queryByText("第一版采用全文搜索还是也支持向量搜索？")).toBeNull());
 expect(stored.wikiKnowledge?.decisions?.u0?.verdict).toBe("confirmed");
 expect(stored.sections).toEqual(session.sections);
 expect(stored.wikiKnowledge?.decisionArbitrations?.search).toMatchObject({ choice: "text", deferredToDraft: true });
 const decisions = within(screen.getByRole("region", { name: "已定的关键决定" }));
 const row = within((await decisions.findByText(choices[0])).closest("li")!);
 fireEvent.click(row.getByRole("button", {name:"查看章节"}));
 expect(onRead).toHaveBeenCalledWith(session.sections[0].id, undefined);
 fireEvent.click(row.getByRole("button", {name:"编辑决定"}));
 fireEvent.change(row.getByRole("textbox", {name:"决定内容"}), {target:{value:"第一版支持全文搜索，第二版再评估向量搜索。"}});
 fireEvent.click(row.getByRole("button", {name:"保存决定"}));
 await waitFor(() => expect(stored.wikiKnowledge?.decisionArbitrations?.search?.mode).toBe("custom"));
 expect(stored.sections).toEqual(session.sections);
 expect(open().queryByText("第一版采用全文搜索还是也支持向量搜索？")).toBeNull();
 fireEvent.click(decisions.getByRole("button", {name:"编辑决定"}));
 fireEvent.click(decisions.getByRole("button", {name:"移回待决"}));
 await waitFor(() => expect(stored.wikiKnowledge?.decisionArbitrations?.search).toBeUndefined());
 expect(stored.wikiKnowledge?.decisions?.u0).toBeUndefined();
 fireEvent.click(open().getByText("查看全部待决问题"));
 fireEvent.click(open().getByText("是否确定发布前需要运行测试？"));
 fireEvent.click(open().getByText("是否确定发布前需要运行测试？").closest("details")!.querySelector(".knowledge-more > summary")!);
 const defer = await open().findByRole("button", {name:"暂缓"});
 expect(open().queryByRole("radio", {name:"暂不决定"})).toBeNull();
 fireEvent.click(defer);
 await waitFor(() => expect(stored.projectMaintenance?.deferredOverviewQuestions).toEqual(["tests"]));
 expect(stored.wikiKnowledge?.decisions?.u2).toBeUndefined();
 fireEvent.click(open().getByText("已暂缓"));
 fireEvent.click(await open().findByText("是否确定发布前需要运行测试？"));
 fireEvent.click(await open().findByRole("button", {name:"继续处理"}));
 await waitFor(() => expect(stored.projectMaintenance?.deferredOverviewQuestions).toEqual([]));
 expect(open().getByText("是否确定发布前需要运行测试？").closest("details")).toHaveAttribute("data-decision-id", "tests");
 const draft = { ...stored, wikiKnowledge: { ...stored.wikiKnowledge!, draft: {
   version: 1 as const, generatedAt: 1, status: "complete" as const, chapters: [], report: {},
 } } };
 cleanup();
 onRead.mockClear();
 onLocate.mockClear();
 render(<DocumentOverview session={draft} zh onRead={onRead} onLocate={onLocate}/>);
 const linked = within(screen.getByRole("region", { name: "待决问题" }));
 fireEvent.click(linked.getByText("是否确定发布前需要运行测试？").closest("summary")!);
 expect(onRead).not.toHaveBeenCalled();
 expect(onLocate).not.toHaveBeenCalled();
 expect(linked.getByRole("radio",{name:choices[2]})).toBeDisabled();
});

it("keeps repeated suggestions in the ledger without raising them in the overview", async () => {
 const session = contextKnowledge().session;
 const text = "第一版仅允许管理员导出完整项目档案。";
 const statements = [text, text, "第二版仅允许管理员导出完整项目档案。"];
 const units: WikiKnowledgeUnit[] = statements.map((statement, index) => ({
   id: `export-${index}`, subject: "导出权限", statement, kind: "constraint", details: [], delivery: "planned", adoption: { status: "proposal" },
   evidence: { conversationId: "c", messageId: `export-source-${index}`, evidenceId: `export-ref-${index}`, messageIndex: index,
      quote: statement, role: "assistant", pasted: false },
 }));
 session.evidence.push(...units.map(unit => ({ id:unit.evidence.evidenceId, conversationId:"c", messageId:unit.evidence.messageId,
   title:"导出讨论", excerpt:unit.statement })));
 session.wikiKnowledge = { version:1, generatedAt:1, status:"complete", materials:3,
   batches:[{ sourceIds:[], units, rejected:{}, status:"ok" }],
   organization:{ version:1, generatedAt:1, status:"complete", report:{}, relations:[], merged:[],
     chapters:[{ id:session.sections[0].id, title:session.sections[0].title, group:"", question:"", subtopics:[{ title:"导出权限", subjectIds:["export"] }] }],
     subjects:[{ id:"export", name:"导出权限", aliases:[], unitIds:units.map(unit=>unit.id) }] },
   draft:{ version:1, generatedAt:1, status:"complete", chapters:[], report:{} },
 };
 const onLocate = vi.fn();
 render(<>
   <KnowledgeLedger session={session} zh onLocate={onLocate}/>
   <DocumentOverview session={session} zh onLocate={onLocate} onRead={vi.fn()}/>
 </>);
 const ledger = within(screen.getByRole("region",{name:"知识点账本"}));
 fireEvent.click(ledger.getByRole("tab", {name:/AI 建议/u}));
 expect(ledger.getAllByText(text).length).toBeGreaterThan(0);
 expect(screen.queryByText("可选建议")).toBeNull();
 expect(screen.queryByRole("region",{name:"待决问题"})).toBeNull();
 expect(session.wikiKnowledge.decisions).toBeUndefined();
});

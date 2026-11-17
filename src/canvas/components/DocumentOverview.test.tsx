import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentOverview } from "./DocumentOverview";
import { contextKnowledge } from "../../test/context-fixture";
import { WorkspaceEvidenceContext } from "../workspace-evidence-context";
import type { WikiKnowledgeUnit } from "../../shared/wiki-knowledge";
import { sourceMessageSignature } from "../../shared/source-signature";
import { readSessionSource } from "../../storage/source-versions";

afterEach(cleanup);
vi.mock("../../storage/source-versions", async importOriginal => ({
 ...await importOriginal<typeof import("../../storage/source-versions")>(), readSessionSource: vi.fn(),
}));
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

it("places the description edit button beside evidence review and keeps the existing editor and save action", async () => {
 const session=contextKnowledge().session,onMaintain=vi.fn().mockResolvedValue(undefined);
 session.brief=undefined;session.projectState=undefined;session.sections[0].title="产品定位";session.sections[0].body="ChatAtlas 是帮助用户找回历史讨论的本地知识助手。";
 const {container}=render(<DocumentOverview session={session} zh onRead={vi.fn()} onLocate={vi.fn()} onMaintain={onMaintain}/>);
 const edit=screen.getByRole("button",{name:"编辑说明"}),actions=container.querySelector(".document-overview-actions")!;
 expect(actions).toContainElement(edit);expect(within(actions as HTMLElement).getByRole("button",{name:"核对依据"})).toBeVisible();
 expect(container.querySelector(".project-overview-intro")).not.toContainElement(edit);
 fireEvent.click(edit);fireEvent.change(screen.getByRole("textbox",{name:"项目说明"}),{target:{value:"我的项目说明"}});fireEvent.click(screen.getByRole("button",{name:"保存"}));
 expect(onMaintain).toHaveBeenCalledWith({...session.projectMaintenance,overview:"我的项目说明"});
});

it("lists every chapter in one numbered list without part labels, even when the Wiki has parts", () => {
  const session = contextKnowledge().session, [first, second] = session.sections;
  session.sections = [first, ...Array.from({ length: 3 }, (_, i) => ({ ...first, id: `tech-${i}`, title: `存储细节${i}` })), second, ...Array.from({ length: 3 }, (_, i) => ({ ...second, id: `ui-${i}`, title: `界面细节${i}` }))];
  session.sections.forEach((section, index) => { section.wikiGroup = index < 4 ? "技术" : "界面"; section.wikiGroupEdited = true; });
  const { container } = render(<DocumentOverview session={session} zh onRead={vi.fn()} onLocate={vi.fn()} />);
  expect(screen.queryByText(/部分/u)).toBeNull();
  expect(screen.queryByRole("region", { name: "技术" })).toBeNull();expect(container.querySelectorAll(".document-overview-chapters ol")).toHaveLength(1);
  expect(screen.getByText("01")).toBeVisible();expect(screen.getByText("08")).toBeVisible();
});

it("keeps one flat chapter list without a part count when all chapters share a part", () => {
  const session = contextKnowledge().session;
  for (const section of session.sections) { section.wikiGroup = "技术"; section.wikiGroupEdited = true; }
  render(<DocumentOverview session={session} zh onRead={vi.fn()} onLocate={vi.fn()} />);
  expect(screen.queryByText(/个部分/u)).toBeNull();
  expect(screen.queryByRole("region", { name: "技术" })).toBeNull();
  expect(screen.getByText("数据库存储")).toBeVisible();
});

it("lays out its heading as a chapter does, actions above the title, and scope in its own full-width row below",()=>{
 const session=contextKnowledge().session;session.brief=undefined;session.projectState=undefined;session.sections[0].title="产品定位";session.sections[0].body="ChatAtlas 是帮助用户找回历史讨论的本地知识助手。";
 const {container}=render(<DocumentOverview session={session} zh onRead={vi.fn()} onLocate={vi.fn()} scope={<details className="wiki-scope-notice"><summary>整理范围：11 段作为背景参考</summary></details>}/>);
 const row=container.querySelector(".document-overview-heading > .wiki-document-location")!;
 expect(row).toHaveTextContent("文档总览");expect(container.querySelector(".document-overview-heading > h1")).toHaveTextContent(session.title);
 // The same text button as in a chapter, not an icon.
 const evidence=within(row as HTMLElement).getByRole("button",{name:"核对依据"});expect(evidence.textContent).toBe("核对依据");
 const heading=container.querySelector(".document-overview-heading")!;
 const scope=container.querySelector(".wiki-scope-notice")!;
 expect(scope.parentElement).toHaveClass("document-overview");
 expect(heading.compareDocumentPosition(scope)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(container.querySelector(".document-overview-heading small")).toBeNull();
});
it("shows sourced milestones and preserves an existing personal plan below the timeline",async()=>{
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
  batches:[{sourceIds:units.map(unit=>unit.id),status:"ok",rejected:{},units}]};
 session.projectMaintenance={currentPlan:"v0.1 先交付全文搜索。"};
 vi.mocked(readSessionSource).mockResolvedValue(messages);
 render(<DocumentOverview session={session} zh onRead={vi.fn()} onLocate={onLocate}/>);
 const region=await screen.findByRole("region",{name:"产品演进"}),timeline=within(region);
 expect(timeline.getAllByRole("listitem")).toHaveLength(3);
 expect(timeline.getByText("已确认决定")).toBeVisible();
 expect(timeline.getByText("用户报告完成")).toBeVisible();
 expect(timeline.getByText("用户报告发布")).toBeVisible();
 expect(timeline.getByText("因为用户需要在本地快速找回对话")).toBeVisible();
 expect(timeline.queryByText(originals[3].text)).toBeNull();
 await waitFor(()=>expect(region.querySelectorAll("time")).toHaveLength(2));
 expect(timeline.getByText("日期未记录")).toBeVisible();
 expect(region.querySelector("time")).toHaveAttribute("datetime","2026-10-12T00:00:00.000Z");
 fireEvent.click(timeline.getByRole("button",{name:"来源 2"}));
 expect(onLocate).toHaveBeenCalledWith(primary,{references:[primary,repeat],mode:"view"});
 fireEvent.click(within(timeline.getByText(originals[2].text).closest("li")!).getByRole("button",{name:"来源"}));
 expect(onLocate).toHaveBeenCalledWith(session.evidence.find(ref=>ref.id==="step-2"));
 expect(screen.getByText("已保存的规划").closest("details")).not.toHaveAttribute("open");
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

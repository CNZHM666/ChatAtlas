import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentOverview } from "./DocumentOverview";
import { contextKnowledge } from "../../test/context-fixture";
import { WorkspaceEvidenceContext } from "../workspace-evidence-context";

afterEach(cleanup);
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

it("puts title actions beside the title and scope in its own full-width row below the heading",()=>{
 const session=contextKnowledge().session;session.brief=undefined;session.projectState=undefined;session.sections[0].title="产品定位";session.sections[0].body="ChatAtlas 是帮助用户找回历史讨论的本地知识助手。";
 const {container}=render(<DocumentOverview session={session} zh onRead={vi.fn()} onLocate={vi.fn()} scope={<details className="wiki-scope-notice"><summary>整理范围：11 段作为背景参考</summary></details>}/>);
 const row=container.querySelector(".document-overview-title-row")!;
 expect(row.querySelector("h1")).toHaveTextContent(session.title);
 const evidence=within(row as HTMLElement).getByRole("button",{name:"核对依据"});expect(evidence).toHaveAttribute("title","核对依据");expect(evidence.textContent).toBe("");
 const heading=container.querySelector(".document-overview-heading")!;
 const scope=container.querySelector(".wiki-scope-notice")!;
 expect(scope.parentElement).toHaveClass("document-overview");
 expect(heading.compareDocumentPosition(scope)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(container.querySelector(".document-overview-heading small")).toBeNull();
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

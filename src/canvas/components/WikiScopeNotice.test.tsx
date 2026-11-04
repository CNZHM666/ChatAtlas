import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {WikiScopeNotice} from "./WikiScopeNotice";
import {contextKnowledge} from "../../test/context-fixture";
import type {FocusSession} from "../../shared/focus-session";
afterEach(cleanup);
const scopeState=()=>document.querySelector(".wiki-scope-notice > summary .wiki-scope-state")?.textContent;
const footnote=()=>document.querySelector(".wiki-scope-notice .wiki-scope-status")?.textContent;

it("puts a labelled recheck next to collapse without toggling the scope section",()=>{
 const retry=vi.fn();render(<WikiScopeNotice session={fixture()} zh onApply={vi.fn()} onSource={vi.fn()} onRetry={retry}/>);
 const button=screen.getByRole("button",{name:"重新核对"}),notice=document.querySelector(".wiki-scope-notice")!;
 expect(button.closest("summary")).toBe(notice.querySelector("summary"));expect(button.nextElementSibling).toHaveClass("wiki-scope-collapse-icon");
 expect(button.querySelector("svg")).toHaveAttribute("width","14");expect(button.nextElementSibling?.querySelector("svg")).toHaveAttribute("width","16");
 expect(button).toHaveTextContent("重新核对");expect(button).toHaveAttribute("title","重新核对内容范围");expect(screen.queryByText("更多选项")).toBeNull();
 fireEvent.click(button);expect(retry).toHaveBeenCalledOnce();expect(notice).toHaveAttribute("open");
 fireEvent.click(screen.getAllByRole("button",{name:"保留本项目"})[0]);expect(button).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"撤销选择"}));expect(button).toBeEnabled();
});

it("lists only explicit outside-project suggestions, excluding related, uncertain and unchecked materials",()=>{
 const session=fixture(),before=structuredClone(session);
 session.wikiScopeReview!.unreviewed=Array.from({length:19},(_,index)=>({id:`source-${index}`,key:`source-${index}`,title:"来源补充 / Source detail",body:"相关的源材料",evidenceIds:[],reason:"missing_receipt" as const}));
 session.wikiScopeReview!.status="incomplete";
 const {rerender}=render(<WikiScopeNotice session={session} zh onApply={vi.fn()} onSource={vi.fn()}/>);
 expect(within(screen.getByRole("region",{name:"待你确认"})).getAllByRole("button",{name:/^阅读材料：/})).toHaveLength(1);
 expect(screen.getByRole("button",{name:"阅读材料：旅游计划"})).toBeVisible();
 expect(within(screen.getByRole("region",{name:"待你确认"})).queryByRole("button",{name:"阅读材料：归属不明"})).toBeNull();
 // Uncertain rows open from the footnote, at the same level, never as a nested disclosure.
 expect(screen.getByRole("button",{name:"归属不确定 1 项"})).toHaveAttribute("aria-expanded","false");
 expect(screen.queryByRole("region",{name:"归属不确定"})).toBeNull();
 expect(screen.queryByText("来源补充 / Source detail")).toBeNull();
 expect(screen.queryByRole("button",{name:"阅读材料：竞品示例"})).toBeNull();
 expect(scopeState()).toBe("项目外 1 项待确认");
 expect(footnote()).toBe("归属不确定 1 项 · 未核对 19 项，仍保留在 Wiki 中，可重新核对。");
 fireEvent.click(screen.getByRole("button",{name:"归属不确定 1 项"}));
 expect(within(screen.getByRole("region",{name:"归属不确定"})).getByText("归属不明")).toBeVisible();
 const confirmed={...session,wikiScopeReview:{...session.wikiScopeReview!,includeKeys:[...before.wikiScopeReview!.includeKeys,"other-key"]}};
 rerender(<WikiScopeNotice session={confirmed} zh onApply={vi.fn()} onSource={vi.fn()}/>);
 expect(screen.queryByRole("button",{name:"阅读材料：旅游计划"})).toBeNull();
 expect(screen.queryByLabelText("材料阅读")).toBeNull();
 expect(session.wikiScopeReview!.unreviewed).toHaveLength(19);
});

it("lists uncertain membership directly under a collapsed header and lets the user resolve it",()=>{
 const session=fixture(),apply=vi.fn();session.wikiScopeReview!.materials=session.wikiScopeReview!.materials.filter(item=>item.kind==="uncertain");
 render(<WikiScopeNotice session={session} zh onApply={apply} onSource={vi.fn()}/>);
 expect(scopeState()).toBe("归属不确定 1 项");
 expect(screen.queryByRole("region",{name:"待你确认"})).toBeNull();
 // The header already gives the count: no second "归属不确定 1 项" disclosure inside it.
 const notice=document.querySelector(".wiki-scope-notice")!;
 expect(notice).not.toHaveAttribute("open");expect(notice.querySelectorAll("details")).toHaveLength(0);
 fireEvent.click(notice.querySelector("summary")!);
 const details=screen.getByRole("region",{name:"归属不确定"});
 fireEvent.click(within(details).getByRole("button",{name:"阅读材料：归属不明"}));
 expect(screen.getByRole("complementary",{name:"材料阅读"})).toBeVisible();
 fireEvent.click(within(details).getByRole("button",{name:"保留本项目"}));fireEvent.click(screen.getByRole("button",{name:"应用 1 项选择"}));
 expect(apply).toHaveBeenCalledWith({includeKeys:["earlier-choice","uncertain-key"],excludeKeys:["earlier-exclusion"]});
});

it("renders source formatting directly in the reading pane and allows resetting staged choices",()=>{
 const session=fixture(false),apply=vi.fn();
 session.evidence[0].excerpt="说明 **架构边界**\n\n- 第一项\n- 第二项";
 render(<WikiScopeNotice session={session} zh onApply={apply} onSource={vi.fn()}/>);
 const row=screen.getByRole("button",{name:"阅读材料：旅游计划"}).closest("li")!;
 expect(row).toHaveClass("wiki-scope-material");
 expect(screen.queryByRole("complementary",{name:"材料阅读"})).toBeNull();
 fireEvent.click(within(row).getByRole("button",{name:"阅读材料：旅游计划"}));
 const reader=screen.getByRole("complementary",{name:"材料阅读"});
 expect(within(reader).getByText("架构边界").tagName).toBe("STRONG");
 expect(within(reader).getByText("第一项").closest("li")).not.toHaveClass("wiki-scope-material");
 fireEvent.click(within(row).getByRole("button",{name:"保留本项目"}));
 fireEvent.click(screen.getByRole("button",{name:"撤销选择"}));
 expect(screen.queryByRole("button",{name:"应用 1 项选择"})).toBeNull();
 expect(within(row).getByRole("button",{name:"保留本项目"})).toHaveAttribute("aria-pressed","false");
 expect(apply).not.toHaveBeenCalled();
});
const fixture=(pending=true):FocusSession=>{
 const base=contextKnowledge().session,evidence=base.evidence[0];
 return {...base,sourceRoles:{[evidence.conversationId]:{[evidence.messageId]:"user"}},wikiScopeReview:{version:1,status:"complete",goal:"项目",includeKeys:["earlier-choice"],excludeKeys:["earlier-exclusion"],materials:[
  {id:"n0",key:"other-key",kind:"other",title:"旅游计划",body:"隐藏的内部笔记",reason:"另一项讨论",quote:"生成笔记里的句子",evidenceIds:[evidence.id]},
  {id:"n1",key:"reference-key",kind:"reference",title:"竞品示例",body:"",reason:"用于本项目离线阅读的参考",quote:"参考其他产品",evidenceIds:[evidence.id]},
  ...(pending?[{id:"n2",key:"uncertain-key",kind:"uncertain" as const,title:"归属不明",body:"",reason:"没有说明属于哪个产品",quote:"另一个产品计划",evidenceIds:[]}]:[]),
  {id:"n3",key:"earlier-exclusion",kind:"other",title:"Mem0 公司背景",body:"",reason:"你已移出 Wiki",quote:"",evidenceIds:[],userExcluded:true},
 ]}};
};

it("opens originals first and keeps the generated summary secondary",()=>{
 const session=fixture(),source=vi.fn();render(<WikiScopeNotice session={session} zh onApply={vi.fn()} onSource={source}/>);
 expect(scopeState()).toBe("项目外 1 项待确认");
 expect(screen.queryByText(/原文始终保留/)).toBeNull();
 const pending=screen.getByRole("region",{name:"待你确认"});
 expect(within(pending).queryByText("隐藏的内部笔记")).toBeNull();
 expect(within(pending).getByText("另一项讨论")).toBeVisible();
 fireEvent.click(within(pending).getByRole("button",{name:"阅读材料：旅游计划"}));
 const reader=screen.getByRole("complementary",{name:"材料阅读"});
 expect(within(reader).getByText("隐藏的内部笔记")).not.toBeVisible();
 expect(within(reader).getByText(session.evidence[0].excerpt)).toBeVisible();
 const basis=within(reader).getByRole("region",{name:"核对依据"});
 expect(basis).toBeVisible();expect(basis).toHaveTextContent("AI 建议移出本项目");
 // Why it was flagged comes before the originals.
 expect(basis.compareDocumentPosition(within(reader).getByRole("region",{name:"材料原文"}))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 fireEvent.click(within(reader).getByRole("button",{name:"在对话中查看"}));expect(source).toHaveBeenCalledExactlyOnceWith(session.evidence[0]);
});

it("stages all three destinations and applies one mutually exclusive choice per material",()=>{
 const apply=vi.fn(),session=fixture();session.wikiScopeReview!.materials[2].kind="other";render(<WikiScopeNotice session={session} zh onApply={apply} onSource={vi.fn()}/>);
 const pending=screen.getByRole("region",{name:"待你确认"}),groups=within(pending).getAllByRole("group",{name:/的归属$/});
 fireEvent.click(within(groups[0]).getByRole("button",{name:"保留本项目"}));
 fireEvent.click(within(groups[1]).getByRole("button",{name:"移到旁支"}));
 fireEvent.click(within(groups[1]).getByRole("button",{name:"从本项目移除"}));
 expect(within(groups[1]).getByRole("button",{name:"移到旁支"})).toHaveAttribute("aria-pressed","false");
 expect(apply).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"应用 2 项选择"}));
 expect(apply).toHaveBeenCalledExactlyOnceWith({includeKeys:["earlier-choice","other-key"],excludeKeys:["earlier-exclusion","uncertain-key"],ignoredKeys:["uncertain-key"]});
});

it("keeps removed materials out of the side tray and allows restoration",()=>{
 const session=fixture(false),apply=vi.fn();session.wikiScopeReview!.ignoredKeys=["earlier-exclusion"];
 render(<WikiScopeNotice session={session} zh onApply={apply} onSource={vi.fn()}/>);
 expect(screen.queryByText("旁支 1")).toBeNull();
 fireEvent.click(screen.getByText("已从本项目移除 1 项"));
 const removed=screen.getByText("Mem0 公司背景").closest("li")!;
 fireEvent.click(within(removed).getByRole("button",{name:"保留本项目"}));
 fireEvent.click(screen.getByRole("button",{name:"应用 1 项选择"}));
 expect(apply).toHaveBeenCalledExactlyOnceWith({includeKeys:["earlier-choice","earlier-exclusion"],excludeKeys:[],ignoredKeys:[]});
});

it("disables membership changes during generation",()=>{
 render(<WikiScopeNotice session={fixture()} busy zh onApply={vi.fn()} onSource={vi.fn()}/>);
 for(const button of screen.getAllByRole("button",{name:"从本项目移除"}))expect(button).toBeDisabled();
});

it("shows a missing review rather than interpreting absent metadata as no side material",()=>{
 render(<WikiScopeNotice session={contextKnowledge().session} zh onApply={vi.fn()} onSource={vi.fn()}/>);
 expect(scopeState()).toBe("核对未完成");
 expect(screen.getByText(/范围尚未核对/)).toBeVisible();
 expect(document.querySelector(".wiki-scope-notice")).toHaveAttribute("open");
 expect(screen.queryByText(/AI 未提出旁支内容/)).toBeNull();
});

it("shows an explicit no-suggestion receipt only for a complete scope review",()=>{
 const session=fixture();session.wikiScopeReview={...session.wikiScopeReview!,status:"complete",materials:[]};
 const apply=vi.fn();render(<WikiScopeNotice session={session} zh onApply={apply} onSource={vi.fn()}/>);
 expect(scopeState()).toBe("AI 未提出旁支内容");
 expect(screen.getByText(/不代表全部内容已确认/)).toBeInTheDocument();
 expect(document.querySelector(".wiki-scope-notice")).not.toHaveAttribute("open");
 expect(apply).not.toHaveBeenCalled();
});

it("keeps unchecked source-detail rows out of the outside-project list without marking the review complete",()=>{
 const session=fixture(),apply=vi.fn(),retry=vi.fn();
 session.wikiScopeReview={version:1,status:"incomplete",goal:"硬件平台",includeKeys:[],materials:[],unreviewed:[{id:"n",key:"unchecked",title:"密钥存储的不同方案",body:"complete note",evidenceIds:[session.evidence[0].id],reason:"context_omitted"}]};
 const before=structuredClone(session);render(<WikiScopeNotice session={session} zh onApply={apply} onRetry={retry} onSource={vi.fn()}/>);
 expect(scopeState()).toBe("未核对 1 项");expect(screen.queryByText(/在右侧阅读材料和依据/)).toBeNull();
 expect(document.querySelector(".wiki-scope-notice")).not.toHaveAttribute("open");expect(retry).not.toHaveBeenCalled();
 expect(screen.queryByRole("button",{name:"移到旁支"})).toBeNull();expect(screen.queryByRole("button",{name:/阅读材料/})).toBeNull();
 expect(footnote()).toBe("未核对的材料仍保留在 Wiki 中，可重新核对。");expect(apply).not.toHaveBeenCalled();expect(session).toEqual(before);
});

it("keeps the reading pane outside the review list, navigates full material and can be reopened after closing",()=>{
 const session=fixture(),host=document.createElement("main");document.body.append(host);
 const full="完整的后半部分。".repeat(120);session.wikiScopeReview!.materials[2].body=full;session.wikiScopeReview!.materials[2].kind="other";
 const {unmount}=render(<WikiScopeNotice readerHost={host} session={session} zh onApply={vi.fn()} onSource={vi.fn()}/>);
 expect(host.querySelector(".wiki-scope-reader")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"阅读材料：旅游计划"}));
 expect(host.querySelector(".wiki-scope-reader")).not.toBeNull();
 expect(document.querySelector(".wiki-scope-notice .wiki-scope-reader")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"下一项材料"}));
 expect(screen.getByText(full)).toBeVisible();
 expect(screen.queryByRole("button",{name:"展开全部内容"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"关闭材料阅读"}));
 expect(host.querySelector(".wiki-scope-reader")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"阅读材料：旅游计划"}));
 expect(host.querySelector(".wiki-scope-reader")).not.toBeNull();
 unmount();host.remove();
});

it("flags a chapter the outline explicitly calls outside the project even when AI returned no side candidates",()=>{
 const session=fixture(),apply=vi.fn(),chapter=session.sections[0];
 chapter.title="知识管理与参考";chapter.wikiQuestion="哪些内容属于项目之外的背景讨论？";chapter.wikiMaterialKeys=["part1","part2"];
 session.wikiScopeReview={version:1,status:"complete",goal:"硬件平台",includeKeys:[],materials:[]};
 const {unmount}=render(<WikiScopeNotice session={session} zh onApply={apply} onSource={vi.fn()}/>);
 expect(screen.getByRole("region",{name:"章节归属待确认"})).toBeVisible();expect(screen.queryByText(/AI 未提出旁支内容/)).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"移到旁支"}));fireEvent.click(screen.getByRole("button",{name:"应用 1 项选择"}));
 expect(apply).toHaveBeenCalledExactlyOnceWith({includeKeys:[],excludeKeys:["part1","part2"]});
 unmount();session.wikiScopeReview.includeKeys=["part1","part2"];
 render(<WikiScopeNotice session={session} zh onApply={apply} onSource={vi.fn()}/>);
 expect(screen.queryByRole("region",{name:"章节归属待确认"})).toBeNull();expect(scopeState()).toBe("AI 未提出旁支内容");
});

it("shows a pending review during generation and never starts a retry automatically",()=>{
 const retry=vi.fn();render(<WikiScopeNotice session={contextKnowledge().session} zh busy reviewing onApply={vi.fn()} onRetry={retry} onSource={vi.fn()}/>);
 expect(scopeState()).toBe("正在核对");expect(screen.queryByRole("button",{name:"重新核对"})).toBeNull();expect(retry).not.toHaveBeenCalled();
});

it("never opens the reading pane by itself, also after a review update, and decides inside the pane",()=>{
 const session=fixture(),apply=vi.fn();
 const {rerender}=render(<WikiScopeNotice session={session} zh onApply={apply} onSource={vi.fn()}/>);
 expect(screen.queryByRole("complementary",{name:"材料阅读"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"阅读材料：旅游计划"}));
 const reader=screen.getByRole("complementary",{name:"材料阅读"});
 fireEvent.click(within(within(reader).getByRole("group",{name:"旅游计划的归属"})).getByRole("button",{name:"移到旁支"}));
 const row=screen.getByRole("region",{name:"待你确认"});
 expect(within(row).getByRole("button",{name:"移到旁支"})).toHaveAttribute("aria-pressed","true");
 fireEvent.click(within(reader).getByRole("button",{name:"关闭材料阅读"}));
 rerender(<WikiScopeNotice session={{...session,wikiScopeReview:{...session.wikiScopeReview!}}} zh onApply={apply} onSource={vi.fn()}/>);
 expect(screen.queryByRole("complementary",{name:"材料阅读"})).toBeNull();
});

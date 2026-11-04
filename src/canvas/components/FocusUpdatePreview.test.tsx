import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { FocusSession } from "../../shared/focus-session";
import { FocusUpdatePreview } from "./FocusUpdatePreview";
import { WikiChapterPreview } from "./WikiChapterPreview";
import { projectSession } from "../../test/project-fixture";
afterEach(cleanup);
it("places one summary in the upper slot while its show-all control still updates the chapter preview",()=>{
 const one={id:"a",title:"变化章节",body:"旧正文",kind:"review" as const,evidenceIds:[],transition:""};
 const previous:FocusSession={id:"s",title:"项目",goal:"整理",mode:"work",sourceConversationIds:[],evidence:[],sections:[one,{...one,id:"b",title:"保留章节",body:"保留正文"}],activeSectionId:"a",notes:"",completedSectionIds:[],createdAt:1,updatedAt:1};
 const host=document.createElement("div");document.body.append(host);
 const {container,unmount}=render(<FocusUpdatePreview previous={previous} next={{...previous,sections:[{...one,body:"新正文"},previous.sections[1]]}} zh summaryHost={host}/>);
 expect(host.querySelectorAll(".update-preview-summary")).toHaveLength(1);expect(container.querySelector(".update-preview-summary")).toBeNull();
 expect(screen.queryByText("保留正文")).toBeNull();fireEvent.click(screen.getByRole("button",{name:"查看全部"}));expect(screen.getByText("保留正文")).toBeVisible();
 unmount();host.remove();
});
it("keeps a pending chapter rewrite reachable when switching back to changes only",()=>{
 const section={id:"a",title:"原有章节",body:"保留的正文",kind:"review" as const,evidenceIds:[],transition:""};
 const session:FocusSession={id:"s",title:"项目",goal:"复习",mode:"work",sourceConversationIds:[],evidence:[],sections:[section],activeSectionId:"a",notes:"",completedSectionIds:[],createdAt:1,updatedAt:1};
 render(<FocusUpdatePreview previous={session} next={session} zh pendingSectionId="a" renderSection={(page,content)=><article><h2>{page.title}</h2><button>采用本章整理</button>{content}</article>}/>);
 fireEvent.click(screen.getByRole("button",{name:"查看全部"}));fireEvent.click(screen.getByRole("button",{name:"只看变化"}));
 expect(screen.getByRole("button",{name:"采用本章整理"})).toBeVisible();expect(screen.getByText("保留的正文")).toBeVisible();
});
it("defaults to changed chapters, lets readers compare old text, and preserves the full preview", () => {
  const section = { id: "a", title: "变化章节", body: "之前的解释。", kind: "review" as const, evidenceIds: [], transition: "" };
  const previous: FocusSession = { id: "s", title: "项目", goal: "复习", mode: "review", sourceConversationIds: [], evidence: [], sections: [section, { ...section, id: "b", title: "保留章节", body: "未变化的解释。" }], activeSectionId: "a", notes: "个人记录", completedSectionIds: [], createdAt: 1, updatedAt: 1 };
  render(<FocusUpdatePreview previous={previous} next={{ ...previous, sections: [{ ...section, body: "更新后的解释。" }, previous.sections[1]] }} zh />);
  expect(screen.getByText("更新 1 章")).toBeVisible();expect(screen.queryByText(/保留笔记|未变 1/u)).toBeNull();
  expect(screen.queryByText("未变化的解释。")).toBeNull();
  expect(screen.getAllByText("更新后的解释。").find(node => !node.closest(".chapter-diff"))).toBeVisible();
  fireEvent.click(screen.getByText("和旧版对比")); expect(screen.getByText("之前的解释。").closest(".is-removed")).not.toBeNull(); expect(screen.getAllByText("更新后的解释。").some(node => node.closest(".is-added"))).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "查看全部" })); expect(screen.getByText("未变化的解释。")).toBeVisible();
  expect(previous.sections[0].body).toBe("之前的解释。");
});

it("shows chapter renames and a merged chapter destination before acceptance",()=>{
 const one={id:"section-0",title:"旧名称",body:"原文",kind:"review" as const,evidenceIds:[],transition:""},two={...one,id:"two",title:"重复章节"};
 const previous:FocusSession={id:"s",title:"项目",goal:"整理",mode:"work",sourceConversationIds:[],evidence:[],sections:[one,two],activeSectionId:"one",notes:"",completedSectionIds:[],createdAt:1,updatedAt:1};
 render(<FocusUpdatePreview previous={previous} next={{...previous,sections:[{...one,title:"存储机制",body:"整理结果"}],wikiSectionAliases:{two:"section-0"},wikiContentReview:{version:1,basisSessionId:previous.id,moves:[{fromId:"two",topicTitle:"确认条件",toId:"section-0"}]}}} zh/>);
 fireEvent.click(screen.getByText("内容归属调整 1 项"));expect(screen.getByText("重复章节 / 确认条件 → 存储机制")).toBeVisible();
 expect(screen.getByText("原名：旧名称")).toBeVisible();
 fireEvent.click(screen.getByText("章节变化"));expect(screen.getByText("重复章节 → 存储机制")).toBeVisible();expect(screen.getByText("改名：旧名称 → 存储机制")).toBeVisible();
});

it("summarizes a whole reorganization in one line, hides zero counts, and puts the old text behind a header button",()=>{
 const one={id:"a",title:"旧章节",body:"旧正文。",kind:"review" as const,evidenceIds:["e1"],transition:""};
 const previous:FocusSession={id:"s",title:"项目",goal:"整理",mode:"work",sourceConversationIds:[],evidence:[],sections:[one,{...one,id:"b",title:"另一章"}],activeSectionId:"a",notes:"",completedSectionIds:[],createdAt:1,updatedAt:1};
 const next={...previous,sections:[{...one,title:"新章节",body:"新正文。"}]};
 render(<FocusUpdatePreview previous={previous} next={next} zh renderSection={(section,content,change)=><WikiChapterPreview section={section} zh busy={false} instruction="" onInstruction={()=>undefined} onSources={()=>undefined} onKeep={()=>undefined} onRewrite={()=>undefined} change={change}>{content}</WikiChapterPreview>}/>);
 expect(screen.getByText("1 章（原 2 章）")).toBeVisible();expect(screen.getByText("合并 1 · 改名 1")).toBeVisible();expect(screen.queryByText("本次整理")).toBeNull();
 // Every chapter changed, so there is nothing for "show all" to add.
 expect(screen.queryByRole("button",{name:"查看全部"})).toBeNull();expect(screen.queryByText(/ 0/u)).toBeNull();
 expect(screen.getByText("原名：旧章节")).toBeVisible();
 // The earlier text shows only as a diff, on request: removed in red, added in green.
 expect(screen.queryByText("旧正文。")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"和旧版对比"}));expect(screen.getByText("旧正文。").closest(".is-removed")).not.toBeNull();
});

it("names a same-size reorganization once instead of repeating the chapter count",()=>{
 const previous=projectSession(),next={...previous,sections:previous.sections.map(section=>({...section,body:`${section.body}\n\n新增一段说明。`}))};
 render(<FocusUpdatePreview previous={previous} next={next} zh/>);
 expect(screen.getByText(`重新整理全部 ${next.sections.length} 章`)).toBeVisible();
 expect(screen.queryByText(/（原 \d+ 章）/)).toBeNull();
});
